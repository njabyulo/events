import type { ThreadRecord, ThreadSummaryRecord, ThreadsRepo } from "database/triage";
import {
  QueueLeaseConflictError,
  QueueNotFoundError,
  QueueStoreUnavailableError,
  QueueValidationError,
} from "../queues/queue.errors.js";
import { QueuesUtils } from "../queues/queues.utils.js";

export type ThreadsRepository = Pick<ThreadsRepo,
  | "listThreads"
  | "getThread"
  | "ackThread"
  | "snoozeThread"
>;

export class ThreadsService {
  constructor(private readonly repository: ThreadsRepository) {}

  async listThreads(streamKey: unknown): Promise<ThreadSummaryRecord[]> {
    return this.run(() => this.repository.listThreads(this.streamKey(streamKey)));
  }

  async getThread(id: string): Promise<ThreadRecord> {
    const thread = await this.run(() => this.repository.getThread(
      QueuesUtils.id(id, "thread_id"),
    ));
    if (!thread) throw new QueueNotFoundError("Thread does not exist");
    return thread;
  }

  async ack(id: string, actor: unknown): Promise<void> {
    const result = await this.run(() => this.repository.ackThread(
      QueuesUtils.id(id, "thread_id"),
      this.actor(actor),
    ));
    this.assertAction(result);
  }

  async snooze(id: string, actor: unknown, delaySeconds: unknown): Promise<void> {
    const result = await this.run(() => this.repository.snoozeThread(
      QueuesUtils.id(id, "thread_id"),
      this.actor(actor),
      QueuesUtils.integer(delaySeconds, "delay_seconds", 3_600, 60, 604_800),
    ));
    this.assertAction(result);
  }

  private assertAction(result: "updated" | "stale" | "not_found"): void {
    if (result === "not_found") throw new QueueNotFoundError("Thread does not exist");
    if (result === "stale") throw new QueueLeaseConflictError();
  }

  private streamKey(value: unknown): string {
    const key = typeof value === "string" ? value.trim() : "";
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(key)) {
      throw new QueueValidationError("invalid_stream_key", "streamKey is invalid");
    }
    return key;
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

export const createThreadsService = (repository: ThreadsRepository): ThreadsService => (
  new ThreadsService(repository)
);
