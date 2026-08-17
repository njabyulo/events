import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { Client } from "pg";
import { streamsService } from "../../triage/triage.dependencies.js";
import { triageConfig } from "../../triage/triage.config.js";
import { DATABASE_URL, SSE_CHANNEL } from "../events.config.js";

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
      const messages = await streamsService.listMessages(
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
          const messages = await streamsService.listMessages(
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

  private async send(message: Awaited<ReturnType<typeof streamsService.listMessages>>[number]) {
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) > triageConfig.sseMaxFrameBytes) {
      throw new Error(`SSE frame ${message.id} exceeds the configured byte limit`);
    }
    await this.stream.writeSSE({
      id: message.id,
      event: message.eventName,
      data,
    });
    this.cursor = message.id;
  }
}

const activeClients = new Set<DurableSseClient>();

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
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for SSE");
    const listener = new Client({ connectionString: DATABASE_URL });
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
      await listener.query(`LISTEN "${SSE_CHANNEL}"`);
      console.log(`SSE listener active on "${SSE_CHANNEL}"`);
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
    }, triageConfig.sseReconnectDelayMs);
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

export const streamEventsHandler = (c: Context) => {
  if (activeClients.size >= triageConfig.sseMaxClients) {
    return c.json({
      error: { code: "sse_capacity_reached", message: "Too many stream connections" },
    }, 429);
  }

  const streamKey = c.req.param("streamKey") || triageConfig.streamKey;
  const cursor = resumeCursor(c);
  c.header("Cache-Control", "no-cache, no-store");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const highWaterMark = await streamsService.getHighWaterMark(streamKey);
    const client = new DurableSseClient(streamKey, cursor, stream);
    await client.replayThrough(highWaterMark);
    activeClients.add(client);
    stream.onAbort(() => {
      activeClients.delete(client);
    });
    client.wake();

    try {
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(triageConfig.sseHeartbeatMs);
        if (stream.aborted || stream.closed) break;
        await stream.write(": heartbeat\n\n");
      }
    } finally {
      activeClients.delete(client);
    }
  });
};
