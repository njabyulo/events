import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { Client } from "pg";
import { streamsHandlers } from "../../modules/triage/streams.module.js";
import { triageConfig } from "../../modules/triage/triage.config.js";
import { sseConfig } from "./sse.config.js";
import { SseUtils } from "./sse.utils.js";

const STREAM_BATCH_SIZE = 100;
type StreamMessage = Awaited<ReturnType<typeof streamsHandlers.listMessages>>[number];

class DurableSseClient {
  private cursor: string;
  private closed = false;

  constructor(
    readonly streamKey: string,
    cursor: string,
    private readonly stream: SSEStreamingApi,
  ) {
    this.cursor = cursor;
  }

  get cursorId(): string {
    return this.cursor;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async replayThrough(highWaterMark: string): Promise<void> {
    while (!this.closed) {
      const messages = await streamsHandlers.listMessages(
        this.streamKey,
        this.cursor,
        highWaterMark,
        STREAM_BATCH_SIZE,
      );
      if (messages.length === 0) return;
      for (const message of messages) await this.send(message);
      if (messages.length < STREAM_BATCH_SIZE) return;
    }
  }

  async send(message: StreamMessage): Promise<void> {
    if (this.closed || BigInt(message.id) <= BigInt(this.cursor)) return;
    const frame = SseUtils.frame(message, sseConfig.maxFrameBytes);
    if (frame.skipped) {
      console.error("SSE frame replaced with a bounded skip marker", {
        streamKey: this.streamKey,
        streamMessageId: message.id,
      });
    }
    await this.stream.writeSSE({
      id: frame.id,
      event: frame.event,
      data: frame.data,
    });
    this.cursor = message.id;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stream.close().catch(() => undefined);
  }
}

class StreamClientGroup {
  readonly clients = new Set<DurableSseClient>();
  private pumping = false;
  private pumpRequested = false;

  constructor(readonly streamKey: string) {}

  add(client: DurableSseClient): void {
    this.clients.add(client);
  }

  remove(client: DurableSseClient): void {
    this.clients.delete(client);
  }

  wake(): void {
    this.pumpRequested = true;
    if (!this.pumping) void this.pump();
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients].map((client) => client.close()));
    this.clients.clear();
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      while (this.pumpRequested && this.clients.size > 0) {
        this.pumpRequested = false;
        while (this.clients.size > 0) {
          const active = [...this.clients].filter((client) => !client.isClosed);
          if (active.length === 0) break;
          const afterId = active.reduce((minimum, client) => (
            BigInt(client.cursorId) < BigInt(minimum) ? client.cursorId : minimum
          ), active[0]?.cursorId ?? "0");
          const messages = await streamsHandlers.listMessages(
            this.streamKey,
            afterId,
            undefined,
            STREAM_BATCH_SIZE,
          );
          if (messages.length === 0) break;
          for (const message of messages) {
            const recipients = active.filter((client) => (
              !client.isClosed && BigInt(client.cursorId) < BigInt(message.id)
            ));
            const sent = await Promise.allSettled(
              recipients.map((client) => client.send(message)),
            );
            await Promise.all(sent.flatMap((result, index) => {
              if (result.status === "fulfilled") return [];
              const client = recipients[index];
              if (!client) return [];
              this.clients.delete(client);
              console.error("SSE client delivery failed", {
                streamKey: this.streamKey,
                reason: result.reason,
              });
              return [client.close()];
            }));
          }
          if (messages.length < STREAM_BATCH_SIZE) break;
        }
      }
    } catch (error) {
      console.error("SSE stream fan-out failed", { streamKey: this.streamKey, error });
    } finally {
      this.pumping = false;
      if (this.pumpRequested && this.clients.size > 0) void this.pump();
    }
  }
}

const activeGroups = new Map<string, StreamClientGroup>();
let pendingClients = 0;

function activeClientCount(): number {
  let count = 0;
  for (const group of activeGroups.values()) count += group.clients.size;
  return count;
}

function groupFor(streamKey: string): StreamClientGroup {
  const existing = activeGroups.get(streamKey);
  if (existing) return existing;
  const created = new StreamClientGroup(streamKey);
  activeGroups.set(streamKey, created);
  return created;
}

function removeClient(client: DurableSseClient): void {
  const group = activeGroups.get(client.streamKey);
  if (!group) return;
  group.remove(client);
  if (group.clients.size === 0) activeGroups.delete(client.streamKey);
}

export class SseNotificationEngine {
  private started = false;
  private listener?: Client;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const listener = this.listener;
    this.listener = undefined;
    if (listener) await listener.end().catch(() => undefined);
    await Promise.all([...activeGroups.values()].map((group) => group.close()));
    activeGroups.clear();
  }

  private async connect(): Promise<void> {
    if (!this.started) return;
    if (!sseConfig.databaseUrl) throw new Error("DATABASE_URL is required for SSE");
    const listener = new Client({ connectionString: sseConfig.databaseUrl });
    this.listener = listener;
    const disconnected = (error?: Error) => {
      if (!this.started || this.listener !== listener) return;
      this.listener = undefined;
      if (error) console.error("SSE notification listener disconnected", error);
      void listener.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    listener.once("error", disconnected);
    listener.once("end", () => disconnected());
    listener.on("notification", (message) => {
      const messageId = message.payload ?? "";
      if (!/^\d+$/.test(messageId)) return;
      void streamsHandlers.getMessageStreamKey(messageId).then((streamKey) => {
        if (streamKey) activeGroups.get(streamKey)?.wake();
      }).catch((error) => {
        console.error("SSE notification lookup failed", error);
        for (const group of activeGroups.values()) group.wake();
      });
    });

    try {
      await listener.connect();
      if (!this.started || this.listener !== listener) {
        await listener.end();
        return;
      }
      await listener.query(`LISTEN "${sseConfig.channel}"`);
      console.log(`SSE listener active on "${sseConfig.channel}"`);
      for (const group of activeGroups.values()) group.wake();
    } catch (error) {
      disconnected(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, sseConfig.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }
}

export const sseNotificationEngine = new SseNotificationEngine();

export function startSseNotificationEngine(): void {
  sseNotificationEngine.start();
}

function resumeCursor(c: Context): string {
  const value = c.req.header("Last-Event-ID") ?? c.req.query("lastEventId") ?? "0";
  return SseUtils.cursor(value);
}

export const streamEvents = (c: Context) => {
  if (activeClientCount() + pendingClients >= sseConfig.maxClients) {
    return c.json({
      error: { code: "sse_capacity_reached", message: "Too many stream connections" },
    }, 429);
  }

  const streamKey = c.req.param("streamKey") || triageConfig.streamKey;
  const cursor = resumeCursor(c);
  c.header("Cache-Control", "no-cache, no-store");
  c.header("X-Accel-Buffering", "no");
  pendingClients += 1;

  return streamSSE(c, async (stream) => {
    let client: DurableSseClient | undefined;
    let reservationHeld = true;
    try {
      const highWaterMark = await streamsHandlers.getHighWaterMark(streamKey);
      client = new DurableSseClient(streamKey, cursor, stream);
      await client.replayThrough(highWaterMark);
      const group = groupFor(streamKey);
      group.add(client);
      pendingClients -= 1;
      reservationHeld = false;
      stream.onAbort(() => {
        if (client) removeClient(client);
      });
      group.wake();

      while (!stream.aborted && !stream.closed) {
        await stream.sleep(sseConfig.heartbeatMs);
        if (stream.aborted || stream.closed) break;
        await stream.write(": heartbeat\n\n");
      }
    } finally {
      if (client) removeClient(client);
      if (reservationHeld) pendingClients = Math.max(0, pendingClients - 1);
    }
  });
};
