import type { QueueRecord, ReceivedQueueMessage } from "database/queues";
import { describe, expect, test, vi } from "vitest";
import { createDigestService } from "../../../src/digests/digest.service.js";

const queue: QueueRecord = {
  id: "4",
  name: "digest",
  fifo: false,
  visibilityTimeoutSeconds: 300,
  maxReceiveCount: 3,
  retentionSeconds: 86_400,
  escalate: false,
  quietHours: false,
  digestFlushCron: "0 7 * * *",
  createdAt: "2026-08-17T00:00:00.000Z",
  deletedAt: null,
};

function message(id: string): ReceivedQueueMessage {
  return {
    id,
    queueId: queue.id,
    queueName: queue.name,
    eventId: id,
    routeId: null,
    messageGroupId: "personal",
    priority: "low",
    visibleAt: "2026-08-17T07:00:00.000Z",
    visibleUntil: "2026-08-17T07:05:00.000Z",
    receiptHandle: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    receiveCount: 1,
    enqueuedAt: "2026-08-16T20:00:00.000Z",
    lastError: null,
    event: {
      id,
      source: "gmail",
      sourceEventId: `gmail-${id}`,
      type: "email.received",
      subject: `Message ${id}`,
      actor: "sender@example.com",
      summary: `Summary ${id}`,
      occurredAt: "2026-08-16T20:00:00.000Z",
      ingestedAt: "2026-08-16T20:00:01.000Z",
      correlationId: null,
      causationEventId: null,
      traceId: null,
      detail: { privateBody: "not copied" },
      attributes: {},
      links: [],
    },
  };
}

describe("DigestService", () => {
  test("publishes one replayable digest event then ACKs the claimed batch", async () => {
    const repository = {
      listQueues: vi.fn(async () => [queue]),
      getQueue: vi.fn(async () => queue),
      claimDigestMessages: vi.fn(async () => [message("1"), message("2")]),
      ackMessages: vi.fn(async () => true),
    };
    const publisher = {
      ingestEvent: vi.fn(async () => ({
        id: "99",
        sourceEventId: "digest",
        inserted: true,
      })),
    };
    const service = createDigestService({
      repository,
      publisher,
      clock: () => new Date("2026-08-17T07:00:00.000Z"),
    });

    await expect(service.flushQueue(queue.id)).resolves.toMatchObject({
      eventId: "99",
      messageCount: 2,
      duplicate: false,
    });
    expect(publisher.ingestEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: "digest-scheduler",
      type: "digest.flushed",
      occurredAt: "2026-08-17T07:00:00.000Z",
      detail: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.not.objectContaining({ privateBody: expect.anything() }),
        ]),
      }),
    }));
    expect(repository.ackMessages).toHaveBeenCalledOnce();
  });
});
