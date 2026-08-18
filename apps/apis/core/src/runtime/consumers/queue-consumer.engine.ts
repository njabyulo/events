import type { ConsumerWorker } from "core/consumers";
import { Client } from "pg";

export type QueueConsumerEngineDependencies = {
  name: string;
  createListener: () => Client;
  createWorker: () => Promise<ConsumerWorker>;
  queueChannel: string;
  reconnectDelayMs: number;
  shutdownDeadlineMs: number;
};

export class QueueConsumerEngine {
  private started = false;
  private listener?: Client;
  private worker?: ConsumerWorker;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly dependencies: QueueConsumerEngineDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.initialize();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const listener = this.listener;
    this.listener = undefined;
    if (listener) await listener.end().catch(() => undefined);
    if (this.worker) await this.worker.stop(this.dependencies.shutdownDeadlineMs);
    this.worker = undefined;
  }

  private async initialize(): Promise<void> {
    try {
      this.worker ??= await this.dependencies.createWorker();
      if (!this.started) return;
      this.worker.start();
      await this.connect();
    } catch (error) {
      console.error(`${this.dependencies.name} failed to initialize`, error);
      this.scheduleReconnect();
    }
  }

  private async connect(): Promise<void> {
    if (!this.started || this.listener) return;
    const listener = this.dependencies.createListener();
    this.listener = listener;
    const disconnected = (error?: Error) => {
      if (!this.started || this.listener !== listener) return;
      this.listener = undefined;
      if (error) console.error(`${this.dependencies.name} listener disconnected`, error);
      void listener.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    listener.once("error", disconnected);
    listener.once("end", () => disconnected());
    listener.on("notification", () => this.worker?.wake());
    try {
      await listener.connect();
      if (!this.started || this.listener !== listener) {
        await listener.end();
        return;
      }
      await listener.query(`LISTEN "${this.dependencies.queueChannel}"`);
      console.log(`${this.dependencies.name} listening on "${this.dependencies.queueChannel}"`);
      this.worker?.wake();
    } catch (error) {
      disconnected(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void (this.worker ? this.connect() : this.initialize());
    }, this.dependencies.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }
}

export function databaseListener(): Client {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for queue consumers");
  return new Client({ connectionString });
}
