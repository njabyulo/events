import { Client } from "pg";
import { routerService } from "../../modules/routing/routing.module.js";
import { routerRuntimeConfig } from "./router.config.js";

export type RouterEngineDependencies = {
  createListener: () => Client;
  eventsChannel: string;
  pollIntervalMs: number;
  reconnectDelayMs: number;
  drain: () => Promise<{
    status: "idle" | "committed" | "lease_lost" | "failed";
    error?: Error;
  }[]>;
};

export class RouterEngine {
  private started = false;
  private listener?: Client;
  private pollTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private drainRunning = false;
  private drainRequested = false;

  constructor(private readonly dependencies: RouterEngineDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.pollTimer = setInterval(
      () => this.requestDrain(),
      this.dependencies.pollIntervalMs,
    );
    this.pollTimer.unref?.();
    void this.connect();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const listener = this.listener;
    this.listener = undefined;
    if (listener) await listener.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (!this.started) return;
    const listener = this.dependencies.createListener();
    this.listener = listener;

    const disconnected = (error?: Error) => {
      if (!this.started || this.listener !== listener) return;
      this.listener = undefined;
      console.error("Router notification listener disconnected", error);
      void listener.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    listener.once("error", disconnected);
    listener.once("end", () => disconnected());
    listener.on("notification", () => this.requestDrain());

    try {
      await listener.connect();
      if (!this.started || this.listener !== listener) {
        await listener.end();
        return;
      }
      await listener.query(`LISTEN "${this.dependencies.eventsChannel}"`);
      console.log(`Router listening on "${this.dependencies.eventsChannel}"`);
      this.requestDrain();
    } catch (error) {
      disconnected(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, this.dependencies.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  private requestDrain(): void {
    if (!this.started) return;
    this.drainRequested = true;
    if (!this.drainRunning) void this.drainLoop();
  }

  private async drainLoop(): Promise<void> {
    this.drainRunning = true;
    try {
      while (this.started && this.drainRequested) {
        this.drainRequested = false;
        try {
          const results = await this.dependencies.drain();
          const failure = results.find((result) => result.status === "failed");
          if (failure?.error) console.error("Router attempt failed", failure.error);
          if (
            results.length >= 1_000
            && results.every((result) => result.status === "committed")
          ) {
            this.drainRequested = true;
          }
        } catch (error) {
          console.error("Router backlog scan failed", error);
        }
      }
    } finally {
      this.drainRunning = false;
      if (this.started && this.drainRequested) void this.drainLoop();
    }
  }
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for the routing engine");
  return value;
}

export const routingEngine = new RouterEngine({
  createListener: () => new Client({ connectionString: databaseUrl() }),
  eventsChannel: routerRuntimeConfig.eventsChannel,
  pollIntervalMs: routerRuntimeConfig.pollIntervalMs,
  reconnectDelayMs: routerRuntimeConfig.reconnectDelayMs,
  drain: () => routerService.drain(),
});

export function startRoutingEngine(): void {
  if (routerRuntimeConfig.enabled) routingEngine.start();
}
