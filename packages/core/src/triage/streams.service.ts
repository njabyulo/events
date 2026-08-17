import type { StreamMessageRecord, StreamsRepo } from "database/triage";
import { QueueStoreUnavailableError, QueueValidationError } from "../queues/queue.errors.js";

export type StreamsRepository = Pick<StreamsRepo, "getHighWaterMark" | "listMessages">;

export class StreamsService {
  constructor(private readonly repository: StreamsRepository) {}

  async getHighWaterMark(streamKey: unknown): Promise<string> {
    return this.run(() => this.repository.getHighWaterMark(this.streamKey(streamKey)));
  }

  async listMessages(
    streamKey: unknown,
    afterId: unknown,
    throughId?: unknown,
    limit: unknown = 250,
  ): Promise<StreamMessageRecord[]> {
    return this.run(() => this.repository.listMessages(
      this.streamKey(streamKey),
      this.cursor(afterId, "after_id"),
      throughId === undefined ? undefined : this.cursor(throughId, "through_id"),
      this.limit(limit),
    ));
  }

  private streamKey(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) {
      throw new QueueValidationError("invalid_stream_key", "streamKey is invalid");
    }
    return value;
  }

  private cursor(value: unknown, field: string): string {
    const cursor = typeof value === "string" && value.length > 0 ? value : "0";
    if (!/^\d+$/.test(cursor)) {
      throw new QueueValidationError(`invalid_${field}`, `${field} must be a cursor ID`);
    }
    return cursor;
  }

  private limit(value: unknown): number {
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      throw new QueueValidationError("invalid_stream_limit", "limit must be from 1 to 250");
    }
    return limit;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof QueueValidationError) throw error;
      throw new QueueStoreUnavailableError(error);
    }
  }
}

export const createStreamsService = (repository: StreamsRepository): StreamsService => (
  new StreamsService(repository)
);
