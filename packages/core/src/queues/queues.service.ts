import type {
  MessageAttemptRecord,
  DeadLetterMessageRecord,
  QueueMessageRecord,
  QueueRecord,
  QueueStats,
  QueuesRepo,
  ReceivedQueueMessage,
} from "database/queues";
import {
  QueueConflictError,
  QueueInUseError,
  QueueLeaseConflictError,
  QueueNotFoundError,
  QueueStoreUnavailableError,
  QueueValidationError,
} from "./queue.errors.js";
import { QueuesUtils } from "./queues.utils.js";

export type QueuesRepository = Pick<QueuesRepo,
  | "listQueues"
  | "getQueue"
  | "getQueueByName"
  | "createQueue"
  | "updateQueue"
  | "deleteQueue"
  | "sendMessage"
  | "receiveMessages"
  | "ackMessage"
  | "nackMessage"
  | "releaseMessage"
  | "snoozeMessage"
  | "extendVisibility"
  | "listAttempts"
  | "listDeadLetters"
  | "getStats"
>;

export type CreateQueueCommand = Record<string, unknown>;
export type UpdateQueueCommand = Record<string, unknown>;

export class QueuesService {
  constructor(
    private readonly repository: QueuesRepository,
    private readonly random: () => number = Math.random,
  ) {}

  async listQueues(): Promise<QueueRecord[]> {
    return this.run(() => this.repository.listQueues());
  }

  async getQueue(id: string): Promise<QueueRecord> {
    const queue = await this.run(() => this.repository.getQueue(QueuesUtils.id(id, "queue_id")));
    if (!queue) throw new QueueNotFoundError("Queue does not exist");
    return queue;
  }

  async getQueueByName(name: string): Promise<QueueRecord> {
    const queue = await this.run(() => this.repository.getQueueByName(QueuesUtils.name(name)));
    if (!queue) throw new QueueNotFoundError("Queue does not exist");
    return queue;
  }

  async createQueue(command: CreateQueueCommand): Promise<QueueRecord> {
    try {
      return await this.repository.createQueue({
        name: QueuesUtils.name(command.name),
        fifo: QueuesUtils.optionalBoolean(command.fifo, false),
        visibilityTimeoutSeconds: QueuesUtils.integer(
          command.visibilityTimeoutSeconds,
          "visibility_timeout_seconds",
          30,
          1,
          43_200,
        ),
        maxReceiveCount: QueuesUtils.integer(
          command.maxReceiveCount,
          "max_receive_count",
          3,
          1,
          1_000,
        ),
        retentionSeconds: QueuesUtils.integer(
          command.retentionSeconds,
          "retention_seconds",
          1_209_600,
          60,
          1_209_600,
        ),
        escalate: QueuesUtils.optionalBoolean(command.escalate, false),
        quietHours: QueuesUtils.optionalBoolean(command.quietHours, true),
        digestFlushCron: QueuesUtils.nullableText(
          command.digestFlushCron,
          "digest_flush_cron",
          120,
        ),
      });
    } catch (error) {
      if (QueuesUtils.isUniqueViolation(error)) {
        throw new QueueConflictError();
      }
      throw this.storeError(error);
    }
  }

  async updateQueue(id: string, command: UpdateQueueCommand): Promise<QueueRecord> {
    const existing = await this.getQueue(id);
    const updated = await this.run(() => this.repository.updateQueue(existing.id, {
      name: command.name === undefined ? undefined : QueuesUtils.name(command.name),
      fifo: command.fifo === undefined
        ? undefined
        : QueuesUtils.optionalBoolean(command.fifo, existing.fifo),
      visibilityTimeoutSeconds: command.visibilityTimeoutSeconds === undefined
        ? undefined
        : QueuesUtils.integer(
          command.visibilityTimeoutSeconds,
          "visibility_timeout_seconds",
          existing.visibilityTimeoutSeconds,
          1,
          43_200,
        ),
      maxReceiveCount: command.maxReceiveCount === undefined
        ? undefined
        : QueuesUtils.integer(
          command.maxReceiveCount,
          "max_receive_count",
          existing.maxReceiveCount,
          1,
          1_000,
        ),
      retentionSeconds: command.retentionSeconds === undefined
        ? undefined
        : QueuesUtils.integer(
          command.retentionSeconds,
          "retention_seconds",
          existing.retentionSeconds,
          60,
          1_209_600,
        ),
      escalate: command.escalate === undefined
        ? undefined
        : QueuesUtils.optionalBoolean(command.escalate, existing.escalate),
      quietHours: command.quietHours === undefined
        ? undefined
        : QueuesUtils.optionalBoolean(command.quietHours, existing.quietHours),
      digestFlushCron: command.digestFlushCron === undefined
        ? undefined
        : QueuesUtils.nullableText(command.digestFlushCron, "digest_flush_cron", 120),
    }));
    if (!updated) throw new QueueNotFoundError("Queue does not exist");
    return updated;
  }

  async deleteQueue(id: string): Promise<void> {
    const result = await this.run(() => this.repository.deleteQueue(
      QueuesUtils.id(id, "queue_id"),
    ));
    if (result === "not_found") throw new QueueNotFoundError("Queue does not exist");
    if (result === "in_use") throw new QueueInUseError();
  }

  async sendMessage(queueId: string, command: Record<string, unknown>): Promise<QueueMessageRecord> {
    const message = await this.run(() => this.repository.sendMessage({
      queueId: QueuesUtils.id(queueId, "queue_id"),
      eventId: QueuesUtils.id(command.eventId, "event_id"),
      delaySeconds: QueuesUtils.integer(command.delaySeconds, "delay_seconds", 0, 0, 900),
      messageGroupId: QueuesUtils.messageGroupId(command.messageGroupId),
      priority: QueuesUtils.priority(command.priority),
    }));
    if (!message) throw new QueueNotFoundError();
    return message;
  }

  async receiveMessages(
    queueId: string,
    command: Record<string, unknown>,
  ): Promise<ReceivedQueueMessage[]> {
    const messages = await this.run(() => this.repository.receiveMessages({
      queueId: QueuesUtils.id(queueId, "queue_id"),
      maxMessages: QueuesUtils.integer(command.maxMessages, "max_messages", 1, 1, 10),
      visibilityTimeoutSeconds: command.visibilityTimeoutSeconds === undefined
        ? undefined
        : QueuesUtils.integer(
          command.visibilityTimeoutSeconds,
          "visibility_timeout_seconds",
          30,
          1,
          43_200,
        ),
      consumerName: QueuesUtils.consumerName(command.consumerName),
    }));
    if (!messages) throw new QueueNotFoundError("Queue does not exist");
    return messages;
  }

  async ackMessage(
    queueId: string,
    messageId: string,
    receiptHandle: unknown,
    consumerName: unknown,
  ): Promise<void> {
    const acked = await this.run(() => this.repository.ackMessage(
      QueuesUtils.id(queueId, "queue_id"),
      QueuesUtils.id(messageId, "message_id"),
      QueuesUtils.receiptHandle(receiptHandle),
      QueuesUtils.consumerName(consumerName),
    ));
    if (!acked) throw new QueueLeaseConflictError();
  }

  async releaseMessage(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
  ): Promise<boolean> {
    return this.run(() => this.repository.releaseMessage(
      queueId,
      messageId,
      receiptHandle,
      consumerName,
    ));
  }

  async nackMessage(
    queueId: string,
    messageId: string,
    command: Record<string, unknown>,
  ): Promise<void> {
    const receiveCount = QueuesUtils.integer(
      command.receiveCount,
      "receive_count",
      1,
      1,
      1_000_000,
    );
    const nacked = await this.run(() => this.repository.nackMessage({
      queueId: QueuesUtils.id(queueId, "queue_id"),
      messageId: QueuesUtils.id(messageId, "message_id"),
      receiptHandle: QueuesUtils.receiptHandle(command.receiptHandle),
      consumerName: QueuesUtils.consumerName(command.consumerName),
      delaySeconds: QueuesUtils.retryDelaySeconds(receiveCount, this.random),
      error: QueuesUtils.boundedError(command.error),
    }));
    if (!nacked) throw new QueueLeaseConflictError();
  }

  async extendVisibility(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
    visibilityTimeoutSeconds: number,
  ): Promise<boolean> {
    return this.run(() => this.repository.extendVisibility(
      queueId,
      messageId,
      receiptHandle,
      consumerName,
      visibilityTimeoutSeconds,
    ));
  }

  async extendMessageVisibility(
    queueId: string,
    messageId: string,
    command: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.extendVisibility(
      QueuesUtils.id(queueId, "queue_id"),
      QueuesUtils.id(messageId, "message_id"),
      QueuesUtils.receiptHandle(command.receiptHandle),
      QueuesUtils.consumerName(command.consumerName),
      QueuesUtils.integer(
        command.visibilityTimeoutSeconds,
        "visibility_timeout_seconds",
        30,
        1,
        43_200,
      ),
    );
    if (!updated) throw new QueueLeaseConflictError();
  }

  async snoozeMessage(
    queueId: string,
    messageId: string,
    command: Record<string, unknown>,
  ): Promise<void> {
    const snoozed = await this.run(() => this.repository.snoozeMessage(
      QueuesUtils.id(queueId, "queue_id"),
      QueuesUtils.id(messageId, "message_id"),
      QueuesUtils.receiptHandle(command.receiptHandle),
      QueuesUtils.consumerName(command.consumerName),
      QueuesUtils.integer(command.delaySeconds, "delay_seconds", 300, 1, 604_800),
    ));
    if (!snoozed) throw new QueueLeaseConflictError();
  }

  async listAttempts(messageId: string): Promise<MessageAttemptRecord[]> {
    return this.run(() => this.repository.listAttempts(
      QueuesUtils.id(messageId, "message_id"),
    ));
  }

  async listDeadLetters(
    queueId: string,
    limitValue: unknown = 100,
    beforeId?: unknown,
  ): Promise<DeadLetterMessageRecord[]> {
    const id = QueuesUtils.id(queueId, "queue_id");
    await this.getQueue(id);
    const limit = QueuesUtils.integer(limitValue, "limit", 100, 1, 250);
    const cursor = beforeId === undefined
      ? undefined
      : QueuesUtils.id(beforeId, "before_id");
    return this.run(() => this.repository.listDeadLetters(id, limit, cursor));
  }

  async getStats(queueId: string): Promise<QueueStats> {
    const stats = await this.run(() => this.repository.getStats(
      QueuesUtils.id(queueId, "queue_id"),
    ));
    if (!stats) throw new QueueNotFoundError("Queue does not exist");
    return stats;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.storeError(error);
    }
  }

  private storeError(error: unknown): Error {
    if (QueuesUtils.isUniqueViolation(error)) return new QueueConflictError();
    if (
      error instanceof QueueNotFoundError
      || error instanceof QueueConflictError
      || error instanceof QueueLeaseConflictError
      || error instanceof QueueInUseError
      || error instanceof QueueValidationError
    ) return error;
    return new QueueStoreUnavailableError(error);
  }
}

export const createQueuesService = (
  repository: QueuesRepository,
  options: { random?: () => number } = {},
): QueuesService => (
  new QueuesService(repository, options.random)
);
