import type { ReceivedQueueMessage } from "database/queues";
import { describe, expect, test, vi } from "vitest";
import { createConsumerWorker } from "../../../src/consumers/consumer.worker.js";

function message(id: string): ReceivedQueueMessage {
  return {
    id,
    queueId: "1",
    queueName: "career",
    eventId: id,
    routeId: null,
    messageGroupId: "career",
    priority: "normal",
    visibleAt: "2026-08-17T10:05:00.000Z",
    visibleUntil: "2026-08-17T10:05:00.000Z",
    receiptHandle: "00000000-0000-4000-8000-000000000001",
    receiveCount: 1,
    enqueuedAt: "2026-08-17T10:00:00.000Z",
    lastError: null,
    event: {
      id,
      source: "example",
      sourceEventId: `source-${id}`,
      type: "message.received",
      subject: null,
      actor: null,
      summary: `Message ${id}`,
      occurredAt: "2026-08-17T10:00:00.000Z",
      ingestedAt: "2026-08-17T10:00:00.000Z",
      correlationId: null,
      causationEventId: null,
      traceId: null,
      detail: {},
      attributes: {},
      links: [],
    },
  };
}

function dependencies(messages: ReceivedQueueMessage[]) {
  return {
    receive: vi.fn(async () => messages),
    ack: vi.fn(async () => true),
    release: vi.fn(async () => true),
    extendVisibility: vi.fn(async () => true),
  };
}

describe("ConsumerWorker", () => {
  test("ACKs only after a successful handler", async () => {
    const client = dependencies([message("1")]);
    const order: string[] = [];
    client.ack.mockImplementation(async () => {
      order.push("ack");
      return true;
    });
    const worker = createConsumerWorker({
      queueClient: client,
      consumerName: "example-worker",
      maxConcurrency: 2,
      maxDeferred: 10,
      pollIntervalMs: 1_000,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10_000,
      handle: async () => {
        order.push("side-effect");
        return "ack";
      },
    });

    await worker.runOnce();

    expect(order).toEqual(["side-effect", "ack"]);
    expect(client.release).not.toHaveBeenCalled();
  });

  test("releases a lease when the handler crashes", async () => {
    const client = dependencies([message("1")]);
    const worker = createConsumerWorker({
      queueClient: client,
      consumerName: "example-worker",
      maxConcurrency: 1,
      maxDeferred: 10,
      pollIntervalMs: 1_000,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10_000,
      handle: async () => {
        throw new Error("simulated crash");
      },
    });

    await worker.runOnce();

    expect(client.ack).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  test("graceful shutdown releases deferred human work", async () => {
    const client = dependencies([message("1")]);
    const worker = createConsumerWorker({
      queueClient: client,
      consumerName: "dashboard:career",
      maxConcurrency: 1,
      maxDeferred: 10,
      pollIntervalMs: 1_000,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10_000,
      handle: async () => "defer",
    });

    await worker.runOnce();
    expect(worker.inFlightCount).toBe(1);
    await worker.stop();

    expect(client.release).toHaveBeenCalledOnce();
    expect(worker.inFlightCount).toBe(0);
  });

  test("never asks for more messages than available concurrency", async () => {
    const client = dependencies([message("1"), message("2")]);
    const worker = createConsumerWorker({
      queueClient: client,
      consumerName: "bounded-worker",
      maxConcurrency: 2,
      maxDeferred: 10,
      pollIntervalMs: 1_000,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10_000,
      handle: async () => "ack",
    });

    await worker.runOnce();

    expect(client.receive).toHaveBeenCalledWith(expect.objectContaining({ maxMessages: 2 }));
  });
});
