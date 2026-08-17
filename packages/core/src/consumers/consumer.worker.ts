import type { ReceivedQueueMessage } from "database/queues";

export type ConsumerDisposition = "ack" | "release" | "defer";

export type ConsumerQueueClient = {
  receive: (options: {
    maxMessages: number;
    visibilityTimeoutSeconds: number;
    consumerName: string;
  }) => Promise<ReceivedQueueMessage[]>;
  ack: (message: ReceivedQueueMessage) => Promise<boolean>;
  release: (message: ReceivedQueueMessage) => Promise<boolean>;
  extendVisibility: (
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
  ) => Promise<boolean>;
};

export type ConsumerWorkerDependencies = {
  queueClient: ConsumerQueueClient;
  consumerName: string;
  maxConcurrency: number;
  maxDeferred: number;
  pollIntervalMs: number;
  visibilityTimeoutSeconds: number;
  heartbeatIntervalMs: number;
  handle: (message: ReceivedQueueMessage) => Promise<ConsumerDisposition>;
  onError?: (error: Error, message?: ReceivedQueueMessage) => void;
};

export class ConsumerWorker {
  private running = false;
  private polling = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly active = new Map<string, {
    message: ReceivedQueueMessage;
    task: Promise<void>;
  }>();
  private readonly deferred = new Map<string, ReceivedQueueMessage>();

  constructor(private readonly dependencies: ConsumerWorkerDependencies) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      this.dependencies.heartbeatIntervalMs,
    );
    this.heartbeatTimer.unref?.();
    this.requestPoll(0);
  }

  wake(): void {
    if (!this.running) return;
    this.requestPoll(0);
  }

  async runOnce(): Promise<number> {
    const capacity = Math.min(
      this.dependencies.maxConcurrency - this.active.size,
      this.dependencies.maxDeferred - this.deferred.size,
    );
    if (capacity <= 0) return 0;

    const messages = await this.dependencies.queueClient.receive({
      maxMessages: Math.min(capacity, 10),
      visibilityTimeoutSeconds: this.dependencies.visibilityTimeoutSeconds,
      consumerName: this.dependencies.consumerName,
    });
    const tasks = messages.map((message) => this.process(message));
    await Promise.allSettled(tasks);
    return messages.length;
  }

  async stop(deadlineMs = 10_000): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    const active = [...this.active.values()].map(({ task }) => task);
    if (active.length > 0) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled(active),
          new Promise<void>((resolve) => {
            deadline = setTimeout(resolve, deadlineMs);
            deadline.unref?.();
          }),
        ]);
      } finally {
        if (deadline) clearTimeout(deadline);
      }
    }

    const leases = new Map<string, ReceivedQueueMessage>();
    for (const { message } of this.active.values()) leases.set(message.id, message);
    for (const message of this.deferred.values()) leases.set(message.id, message);
    await Promise.allSettled(
      [...leases.values()].map((message) => this.dependencies.queueClient.release(message)),
    );
    this.active.clear();
    this.deferred.clear();
  }

  get inFlightCount(): number {
    return this.active.size + this.deferred.size;
  }

  private requestPoll(delayMs: number): void {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delayMs);
    this.pollTimer.unref?.();
  }

  private async poll(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;
    try {
      const count = await this.runOnce();
      this.requestPoll(count > 0 ? 0 : this.dependencies.pollIntervalMs);
    } catch (error) {
      this.report(error);
      this.requestPoll(this.dependencies.pollIntervalMs);
    } finally {
      this.polling = false;
    }
  }

  private process(message: ReceivedQueueMessage): Promise<void> {
    const task = (async () => {
      try {
        const disposition = await this.dependencies.handle(message);
        if (disposition === "defer") {
          this.deferred.set(message.id, message);
        } else if (disposition === "ack") {
          await this.dependencies.queueClient.ack(message);
        } else {
          await this.dependencies.queueClient.release(message);
        }
      } catch (error) {
        this.report(error, message);
        await this.dependencies.queueClient.release(message).catch((releaseError) => {
          this.report(releaseError, message);
          return false;
        });
      } finally {
        this.active.delete(message.id);
      }
    })();
    this.active.set(message.id, { message, task });
    return task;
  }

  private async heartbeat(): Promise<void> {
    const messages = [...this.deferred.values()];
    await Promise.allSettled(messages.map(async (message) => {
      try {
        const extended = await this.dependencies.queueClient.extendVisibility(
          message,
          this.dependencies.visibilityTimeoutSeconds,
        );
        if (!extended) this.deferred.delete(message.id);
      } catch (error) {
        this.report(error, message);
      }
    }));
  }

  private report(error: unknown, message?: ReceivedQueueMessage): void {
    this.dependencies.onError?.(
      error instanceof Error ? error : new Error(String(error)),
      message,
    );
  }
}

export const createConsumerWorker = (
  dependencies: ConsumerWorkerDependencies,
): ConsumerWorker => new ConsumerWorker(dependencies);
