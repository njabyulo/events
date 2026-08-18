import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { Client } from "pg";
import { streamsHandlers } from "../../modules/triage/streams.module.js";
import { triageConfig } from "../../modules/triage/triage.config.js";
import { sseConfig } from "./sse.config.js";
import { SseUtils } from "./sse.utils.js";

const STREAM_BATCH_SIZE = 100;

class DurableSseClient {
  private cursor: string;
  private pumping = false;
  private pumpRequested = false;
  private closed = false;

  constructor(
    readonly streamKey: string,
    cursor: string,
    private readonly stream: SSEStreamingApi,
  ) {
    this.cursor = cursor;
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

  wake(): void {
    if (this.closed) return;
    this.pumpRequested = true;
    if (!this.pumping) void this.pump();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stream.close().catch(() => undefined);
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      while (!this.closed && this.pumpRequested) {
        this.pumpRequested = false;
        while (!this.closed) {
          const messages = await streamsHandlers.listMessages(
            this.streamKey,
            this.cursor,
            undefined,
            STREAM_BATCH_SIZE,
          );
          if (messages.length === 0) break;
          for (const message of messages) await this.send(message);
          if (messages.length < STREAM_BATCH_SIZE) break;
        }
      }
    } catch (error) {
      console.error("SSE client delivery failed", { streamKey: this.streamKey, error });
      await this.close();
    } finally {
      this.pumping = false;
      if (!this.closed && this.pumpRequested) void this.pump();
    }
  }

  private async send(
    message: Awaited<ReturnType<typeof streamsHandlers.listMessages>>[number],
  ) {
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
}

const activeClients = new Set<DurableSseClient>();
let pendingClients = 0;

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
    await Promise.all([...activeClients].map((client) => client.close()));
    activeClients.clear();
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
      if (!/^\d+$/.test(message.payload ?? "")) return;
      for (const client of activeClients) client.wake();
    });

    try {
      await listener.connect();
      if (!this.started || this.listener !== listener) {
        await listener.end();
        return;
      }
      await listener.query(`LISTEN "${sseConfig.channel}"`);
      console.log(`SSE listener active on "${sseConfig.channel}"`);
      for (const client of activeClients) client.wake();
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
  return /^\d+$/.test(value) ? value : "0";
}

export const streamEvents = (c: Context) => {
  if (activeClients.size + pendingClients >= sseConfig.maxClients) {
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
      activeClients.add(client);
      pendingClients -= 1;
      reservationHeld = false;
      stream.onAbort(() => {
        if (client) activeClients.delete(client);
      });
      client.wake();

      while (!stream.aborted && !stream.closed) {
        await stream.sleep(sseConfig.heartbeatMs);
        if (stream.aborted || stream.closed) break;
        await stream.write(": heartbeat\n\n");
      }
    } finally {
      if (client) activeClients.delete(client);
      if (reservationHeld) pendingClients = Math.max(0, pendingClients - 1);
    }
  });
};
