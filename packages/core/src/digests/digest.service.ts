import { createHash } from "node:crypto";
import type { EventEnvelope } from "../events/events.service.js";
import type { IngestEventResult } from "database/events";
import type {
  QueueRecord,
  QueuesRepo,
  ReceivedQueueMessage,
} from "database/queues";
import {
  QueueLeaseConflictError,
  QueueNotFoundError,
  QueueStoreUnavailableError,
  QueueValidationError,
} from "../queues/queue.errors.js";
import { QueuesUtils } from "../queues/queues.utils.js";

export type DigestRepository = Pick<QueuesRepo,
  | "listQueues"
  | "getQueue"
  | "claimDigestMessages"
  | "ackMessages"
>;

export type DigestPublisher = {
  ingestEvent: (event: EventEnvelope) => Promise<IngestEventResult>;
};

export type DigestFlushResult = {
  queueId: string;
  queueName: string;
  messageCount: number;
  eventId: string;
  duplicate: boolean;
};

export type DigestServiceDependencies = {
  repository: DigestRepository;
  publisher: DigestPublisher;
  consumerName?: string;
  visibilityTimeoutSeconds?: number;
  clock?: () => Date;
};

export class DigestService {
  private readonly consumerName: string;
  private readonly visibilityTimeoutSeconds: number;
  private readonly clock: () => Date;

  constructor(private readonly dependencies: DigestServiceDependencies) {
    this.consumerName = dependencies.consumerName ?? "digest-scheduler";
    this.visibilityTimeoutSeconds = dependencies.visibilityTimeoutSeconds ?? 300;
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async flushDueQueues(): Promise<DigestFlushResult[]> {
    const queues = await this.run(() => this.dependencies.repository.listQueues());
    const results: DigestFlushResult[] = [];
    for (const queue of queues.filter(({ digestFlushCron }) => digestFlushCron !== null)) {
      const result = await this.flush(queue);
      if (result) results.push(result);
    }
    return results;
  }

  async flushQueue(queueId: string): Promise<DigestFlushResult | null> {
    const id = QueuesUtils.id(queueId, "queue_id");
    const queue = await this.run(() => this.dependencies.repository.getQueue(id));
    if (!queue) throw new QueueNotFoundError("Queue does not exist");
    if (!queue.digestFlushCron) {
      throw new QueueValidationError(
        "queue_is_not_digest",
        "Queue does not have a digest flush schedule",
      );
    }
    return this.flush(queue);
  }

  private async flush(queue: QueueRecord): Promise<DigestFlushResult | null> {
    const messages = await this.run(() => this.dependencies.repository.claimDigestMessages(
      queue.id,
      this.visibilityTimeoutSeconds,
      this.consumerName,
    ));
    if (messages === null) throw new QueueNotFoundError("Digest queue does not exist");
    if (messages.length === 0) return null;

    const event = this.digestEvent(queue, messages);
    const published = await this.dependencies.publisher.ingestEvent(event);
    const acked = await this.run(() => this.dependencies.repository.ackMessages(
      messages,
      this.consumerName,
    ));
    if (!acked) throw new QueueLeaseConflictError("Digest leases expired before ACK");
    return {
      queueId: queue.id,
      queueName: queue.name,
      messageCount: messages.length,
      eventId: published.id,
      duplicate: !published.inserted,
    };
  }

  private digestEvent(queue: QueueRecord, messages: ReceivedQueueMessage[]): EventEnvelope {
    const ids = messages.map(({ id }) => id).sort((left, right) => Number(left) - Number(right));
    const batchKey = createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 32);
    const summaries = messages.map(({ event }) => ({
      eventId: event.id,
      source: event.source,
      type: event.type,
      subject: event.subject,
      summary: event.summary,
      occurredAt: event.occurredAt,
    }));
    return {
      source: "digest-scheduler",
      sourceEventId: `digest-${queue.id}-${batchKey}`,
      type: "digest.flushed",
      subject: queue.name,
      actor: this.consumerName,
      summary: `${messages.length} ${queue.name} notifications are ready`,
      occurredAt: this.clock().toISOString(),
      detail: { queueId: queue.id, queueName: queue.name, messages: summaries },
      attributes: {
        schemaVersion: 1,
        queueId: queue.id,
        queueName: queue.name,
        messageCount: messages.length,
      },
      links: [{ kind: "digest_queue", value: queue.name }],
    };
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

export const createDigestService = (
  dependencies: DigestServiceDependencies,
): DigestService => new DigestService(dependencies);
