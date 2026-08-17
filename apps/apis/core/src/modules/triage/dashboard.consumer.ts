import { randomUUID } from "node:crypto";
import { createConsumerWorker, type ConsumerWorker } from "core/consumers";
import type { QueueRecord, ReceivedQueueMessage } from "core/queues";
import { Client } from "pg";
import { queuesService } from "../queues/queues.dependencies.js";
import { triageConfig } from "./triage.config.js";
import { triageService } from "./triage.dependencies.js";

export type DashboardConsumerDependencies = {
  resolveQueue: (name: string) => Promise<QueueRecord>;
  createListener: () => Client;
  createWorker: (queue: QueueRecord, instanceId: string) => ConsumerWorker;
  queueNames: readonly string[];
  queueChannel: string;
  reconnectDelayMs: number;
  shutdownDeadlineMs: number;
};

export class DashboardConsumerEngine {
  private started = false;
  private listener?: Client;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly workers: ConsumerWorker[] = [];
  private readonly instanceId = randomUUID();

  constructor(private readonly dependencies: DashboardConsumerDependencies) {}

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
    await Promise.all(this.workers.map(
      (worker) => worker.stop(this.dependencies.shutdownDeadlineMs),
    ));
    this.workers.length = 0;
  }

  private async initialize(): Promise<void> {
    try {
      const queues = await Promise.all(
        this.dependencies.queueNames.map((name) => this.dependencies.resolveQueue(name)),
      );
      if (!this.started) return;
      for (const queue of queues) {
        const worker = this.dependencies.createWorker(queue, this.instanceId);
        this.workers.push(worker);
        worker.start();
      }
      await this.connect();
    } catch (error) {
      console.error("Dashboard consumer failed to initialize", error);
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
      if (error) console.error("Dashboard queue listener disconnected", error);
      void listener.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    listener.once("error", disconnected);
    listener.once("end", () => disconnected());
    listener.on("notification", () => {
      for (const worker of this.workers) worker.wake();
    });

    try {
      await listener.connect();
      if (!this.started || this.listener !== listener) {
        await listener.end();
        return;
      }
      await listener.query(`LISTEN "${this.dependencies.queueChannel}"`);
      console.log(`Dashboard consumer listening on "${this.dependencies.queueChannel}"`);
      for (const worker of this.workers) worker.wake();
    } catch (error) {
      disconnected(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.workers.length === 0) void this.initialize();
      else void this.connect();
    }, this.dependencies.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for the dashboard consumer");
  return value;
}

function workerFor(queue: QueueRecord, instanceId: string): ConsumerWorker {
  const consumerName = `${triageConfig.consumerName}:${queue.name}`;
  return createConsumerWorker({
    consumerName,
    maxConcurrency: triageConfig.maxConcurrency,
    maxDeferred: triageConfig.maxDeferred,
    pollIntervalMs: triageConfig.pollIntervalMs,
    visibilityTimeoutSeconds: triageConfig.visibilityTimeoutSeconds,
    heartbeatIntervalMs: triageConfig.heartbeatIntervalMs,
    queueClient: {
      receive: (options) => queuesService.receiveMessages(queue.id, options),
      ack: async (message) => {
        await queuesService.ackMessage(
          queue.id,
          message.id,
          message.receiptHandle,
          consumerName,
        );
        return true;
      },
      release: (message) => queuesService.releaseMessage(
        queue.id,
        message.id,
        message.receiptHandle ?? "",
        consumerName,
      ),
      extendVisibility: (message, seconds) => queuesService.extendVisibility(
        queue.id,
        message.id,
        message.receiptHandle ?? "",
        consumerName,
        seconds,
      ),
    },
    handle: async (message: ReceivedQueueMessage) => {
      await triageService.deliver(message, {
        consumerName,
        consumerInstanceId: instanceId,
        streamKey: triageConfig.streamKey,
      });
      return "defer";
    },
    onError: (error, message) => console.error("Dashboard consumer attempt failed", {
      queue: queue.name,
      messageId: message?.id,
      error,
    }),
  });
}

export const dashboardConsumerEngine = new DashboardConsumerEngine({
  resolveQueue: (name) => queuesService.getQueueByName(name),
  createListener: () => new Client({ connectionString: databaseUrl() }),
  createWorker: workerFor,
  queueNames: triageConfig.queueNames,
  queueChannel: triageConfig.queueChannel,
  reconnectDelayMs: triageConfig.reconnectDelayMs,
  shutdownDeadlineMs: triageConfig.shutdownDeadlineMs,
});

export function startDashboardConsumerEngine(): void {
  if (triageConfig.consumerEnabled) dashboardConsumerEngine.start();
}
