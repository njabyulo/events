import type {
  ReceivedQueueMessage,
} from "database/queues";
import type {
  TriageItemRecord,
  TriageRepo,
} from "database/triage";
import {
  QueueLeaseConflictError,
  QueueNotFoundError,
  QueueStoreUnavailableError,
  QueueValidationError,
} from "../queues/queue.errors.js";
import { QueuesUtils } from "../queues/queues.utils.js";

export type TriageRepository = Pick<TriageRepo,
  | "storeClaim"
  | "listItems"
  | "ackItem"
  | "snoozeItem"
>;

export class TriageService {
  constructor(private readonly repository: TriageRepository) {}

  async deliver(
    message: ReceivedQueueMessage,
    options: {
      consumerName: string;
      consumerInstanceId: string;
      streamKey: string;
    },
  ): Promise<TriageItemRecord> {
    return this.run(() => this.repository.storeClaim({ message, ...options }));
  }

  async listItems(streamKey: unknown): Promise<TriageItemRecord[]> {
    return this.run(() => this.repository.listItems(this.streamKey(streamKey)));
  }

  async ack(
    itemId: string,
    receiptHandle: unknown,
    actor: unknown,
  ): Promise<void> {
    const result = await this.run(() => this.repository.ackItem(
      QueuesUtils.id(itemId, "item_id"),
      QueuesUtils.receiptHandle(receiptHandle),
      this.actor(actor),
    ));
    if (result === "not_found") throw new QueueNotFoundError("Triage item does not exist");
    if (result === "stale") throw new QueueLeaseConflictError();
  }

  async snooze(
    itemId: string,
    receiptHandle: unknown,
    actor: unknown,
    delaySeconds: unknown,
  ): Promise<void> {
    const result = await this.run(() => this.repository.snoozeItem(
      QueuesUtils.id(itemId, "item_id"),
      QueuesUtils.receiptHandle(receiptHandle),
      this.actor(actor),
      QueuesUtils.integer(delaySeconds, "delay_seconds", 3_600, 60, 604_800),
    ));
    if (result === "not_found") throw new QueueNotFoundError("Triage item does not exist");
    if (result === "stale") throw new QueueLeaseConflictError();
  }

  private streamKey(value: unknown): string {
    const streamKey = typeof value === "string" ? value.trim() : "";
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(streamKey)) {
      throw new QueueValidationError("invalid_stream_key", "streamKey is invalid");
    }
    return streamKey;
  }

  private actor(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 120) {
      throw new QueueValidationError("invalid_actor", "actor is required");
    }
    return value.trim();
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof QueueNotFoundError
        || error instanceof QueueLeaseConflictError
        || error instanceof QueueValidationError
      ) throw error;
      throw new QueueStoreUnavailableError(error);
    }
  }
}

export const createTriageService = (repository: TriageRepository): TriageService => (
  new TriageService(repository)
);
