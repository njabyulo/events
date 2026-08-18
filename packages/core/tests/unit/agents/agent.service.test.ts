import type { StoredEvent } from "database/events";
import type { ReceivedQueueMessage } from "database/queues";
import type { ThreadRecord } from "database/triage";
import { describe, expect, test, vi } from "vitest";
import { createAgentService } from "../../../src/agents/agent.service.js";

function event(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "101",
    source: "unknown-source",
    sourceEventId: "delivery-101",
    type: "message.received",
    subject: "Production deploy",
    actor: "njabulo",
    summary: "Deployment needs attention",
    occurredAt: "2026-08-17T12:00:00.000Z",
    ingestedAt: "2026-08-17T12:00:01.000Z",
    correlationId: null,
    causationEventId: null,
    traceId: "trace-1",
    detail: { rawGmailBody: "must not leave the event store" },
    attributes: {},
    links: [{ kind: "repository", value: "example/service" }],
    ...overrides,
  };
}

function message(stored = event()): ReceivedQueueMessage {
  return {
    id: "201",
    queueId: "3",
    queueName: "unclassified",
    eventId: stored.id,
    routeId: null,
    messageGroupId: "unclassified",
    priority: "normal",
    visibleAt: "2026-08-17T12:03:00.000Z",
    visibleUntil: "2026-08-17T12:03:00.000Z",
    receiptHandle: "00000000-0000-4000-8000-000000000001",
    receiveCount: 1,
    enqueuedAt: "2026-08-17T12:00:02.000Z",
    lastError: null,
    event: stored,
  };
}

function thread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "9",
    threadKey: "github:pull_request:example/service#42",
    domain: "career",
    priority: "normal",
    channel: "web",
    title: "Review #42",
    brief: "Review requested",
    decidedBy: "rule-stub",
    decisionReason: "rule",
    status: "open",
    firstEventAt: "2026-08-17T10:00:00.000Z",
    lastEventAt: "2026-08-17T10:00:00.000Z",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    ackedAt: null,
    pendingItemCount: 1,
    messages: [event({ id: "90", detail: { secret: "not prompted" } })],
    ...overrides,
  };
}

function dependencies(confidence = 0.92) {
  const agent = {
    classify: vi.fn(async () => ({
      domain: "career" as const,
      priority: "urgent" as const,
      confidence,
      reason: "Production deploy requires review",
      matchedThreadKey: thread().threadKey,
    })),
    reply: vi.fn(async () => ({
      message: "Check the deployment logs around the reported time.",
      reason: "The user asked for investigation help",
    })),
  };
  const publisher = {
    ingestEvent: vi.fn(async (envelope) => ({
      id: envelope.type === "thread.agent_response" ? "303" : "202",
      sourceEventId: String(envelope.sourceEventId),
      inserted: true,
    })),
  };
  const threads = {
    listThreads: vi.fn(async () => [thread()]),
    getThread: vi.fn(async () => thread()),
  };
  const service = createAgentService({
    agent,
    publisher,
    threads,
    config: {
      confidenceThreshold: 0.75,
      modelId: "example-model",
      maxCandidateThreads: 20,
      maxHistoryEvents: 30,
      maxHistoryCharacters: 12_000,
    },
    clock: () => new Date("2026-08-17T12:05:00.000Z"),
  });
  return { service, agent, publisher, threads };
}

describe("AgentService", () => {
  test("re-publishes a confident classification with eval and causation metadata", async () => {
    const { service, agent, publisher } = dependencies();

    await expect(service.consume(message(), "triage")).resolves.toEqual({
      status: "published",
      eventId: "202",
      duplicate: false,
    });
    expect(agent.classify).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.not.objectContaining({ detail: expect.anything() }),
    }));
    expect(publisher.ingestEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: "classifier",
      sourceEventId: "classified-101",
      causationEventId: "101",
      detail: { originalEventId: "101" },
      attributes: expect.objectContaining({
        classifiedBy: "strands-agent",
        domain: "career",
        priority: "urgent",
        channel: "telegram",
        decisionDiff: expect.arrayContaining(["domain", "priority", "channel"]),
      }),
      links: expect.arrayContaining([
        { kind: "thread_key", value: thread().threadKey },
      ]),
    }));
  });

  test("parks low-confidence work for human triage without publishing", async () => {
    const { service, publisher } = dependencies(0.4);

    await expect(service.consume(message(), "triage")).resolves.toMatchObject({
      status: "human",
      decision: {
        domain: "unclassified",
        decidedBy: "strands-agent",
      },
    });
    expect(publisher.ingestEvent).not.toHaveBeenCalled();
  });

  test("ACK-safe loop guard skips events already classified by an agent", async () => {
    const { service, agent, publisher } = dependencies();

    await expect(service.consume(message(event({
      attributes: { classifiedBy: "strands-agent" },
    })), "triage")).resolves.toEqual({ status: "loop_skipped" });
    expect(agent.classify).not.toHaveBeenCalled();
    expect(publisher.ingestEvent).not.toHaveBeenCalled();
  });

  test("re-publishing after a crash uses the same source ID and reports the duplicate", async () => {
    const { service, publisher } = dependencies();
    const seen = new Set<string>();
    publisher.ingestEvent.mockImplementation(async (envelope) => {
      const key = `${envelope.source}:${envelope.sourceEventId}`;
      const inserted = !seen.has(key);
      seen.add(key);
      return { id: "202", sourceEventId: String(envelope.sourceEventId), inserted };
    });

    await expect(service.consume(message(), "triage")).resolves.toMatchObject({
      status: "published",
      duplicate: false,
    });
    await expect(service.consume(message(), "triage")).resolves.toMatchObject({
      status: "published",
      duplicate: true,
    });
    expect(publisher.ingestEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: "classifier",
      sourceEventId: "classified-101",
    }));
    expect(publisher.ingestEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: "classifier",
      sourceEventId: "classified-101",
    }));
  });

  test("responds to a thread reply by publishing another ordinary event", async () => {
    const { service, agent, publisher } = dependencies();
    const replyEvent = event({
      source: "dashboard",
      type: "thread.reply",
      summary: "What should I inspect?",
      links: [
        { kind: "thread_key", value: thread().threadKey },
        { kind: "thread_id", value: thread().id },
      ],
    });

    await expect(service.consume(message(replyEvent), "triage")).resolves.toMatchObject({
      status: "published",
      eventId: "303",
    });
    expect(agent.reply).toHaveBeenCalledWith(expect.objectContaining({
      message: "What should I inspect?",
      history: expect.arrayContaining([
        expect.not.objectContaining({ detail: expect.anything() }),
      ]),
    }));
    expect(publisher.ingestEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: "agent",
      sourceEventId: "thread-response-101",
      type: "thread.agent_response",
      causationEventId: "101",
      links: expect.arrayContaining([
        { kind: "thread_key", value: thread().threadKey },
      ]),
    }));
  });

  test("preserves an unclassified thread domain in an agent response", async () => {
    const { service, threads, publisher } = dependencies();
    threads.getThread.mockResolvedValue(thread({ domain: "unclassified" }));
    const replyEvent = event({
      source: "dashboard",
      type: "thread.reply",
      summary: "Help me classify this",
      links: [{ kind: "thread_id", value: "9" }],
    });

    await service.consume(message(replyEvent), "triage");

    expect(publisher.ingestEvent).toHaveBeenCalledWith(expect.objectContaining({
      attributes: expect.objectContaining({ domain: "unclassified" }),
    }));
  });

  test("bounds reply history to the newest configured events", async () => {
    const { service, threads, agent } = dependencies();
    threads.getThread.mockResolvedValue(thread({
      messages: Array.from({ length: 40 }, (_, index) => event({
        id: String(index + 1),
        summary: `History ${index + 1}`,
      })),
    }));
    const replyEvent = event({
      source: "dashboard",
      type: "thread.reply",
      summary: "What happened recently?",
      links: [{ kind: "thread_id", value: "9" }],
    });

    await service.consume(message(replyEvent), "triage");

    const history = agent.reply.mock.calls[0]?.[0].history ?? [];
    expect(history).toHaveLength(30);
    expect(history[0]?.id).toBe("11");
    expect(history.at(-1)?.id).toBe("40");
  });
});
