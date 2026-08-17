import { expect, test, vi } from "vitest";
import {
  createRouterService,
  type ClaimedRoutingWork,
  type QueueRecord,
  type RouterRepository,
  type RuleSnapshot,
  type StoredEvent,
  type TargetSnapshot,
} from "../../../src/routing/index.js";

const event: StoredEvent = {
  id: "1",
  source: "github",
  sourceEventId: "delivery-1",
  type: "push.created",
  subject: "owner/repo",
  actor: "octocat",
  summary: "Pushed commit",
  occurredAt: "2026-08-16T20:00:00.000Z",
  ingestedAt: "2026-08-16T20:00:01.000Z",
  correlationId: null,
  causationEventId: null,
  traceId: null,
  detail: {},
  attributes: {},
  links: [],
};

function queue(id: string, name: string): QueueRecord {
  return {
    id,
    name,
    fifo: true,
    visibilityTimeoutSeconds: 30,
    maxReceiveCount: 3,
    retentionSeconds: 1_209_600,
    escalate: false,
    quietHours: false,
    digestFlushCron: null,
    createdAt: event.ingestedAt,
    deletedAt: null,
  };
}

function queueTarget(id: string, value: QueueRecord): TargetSnapshot {
  return {
    id,
    name: `${value.name}.queue`,
    kind: "queue",
    config: { queueId: Number(value.id) },
    enabled: true,
    createdAt: event.ingestedAt,
    updatedAt: event.ingestedAt,
    deletedAt: null,
    queue: value,
  };
}

function repository(work: ClaimedRoutingWork | null): RouterRepository {
  return {
    claimNext: vi.fn(async () => work),
    renewLease: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    commit: vi.fn(async (_eventId, _lease, decisions) => ({
      committed: true,
      routesCreated: decisions.length,
      deliveriesCreated: decisions.length,
      skipsRecorded: 0,
    })),
    markRuleInvalid: vi.fn(async () => undefined),
    getEventRoutes: vi.fn(async () => []),
    getEventRoutingSkips: vi.fn(async () => []),
  };
}

test("one matching rule fans out independently and stamps queue domain and priority", () => {
  const career = queue("1", "career");
  const rule: RuleSnapshot = {
    id: "10",
    name: "github.career",
    version: 3,
    pattern: { source: ["github"] },
    priority: "urgent",
    targets: [
      queueTarget("20", career),
      {
        id: "21",
        name: "dashboard",
        kind: "sse",
        config: { streamKey: "triage", replayRetentionSeconds: 3600 },
        enabled: true,
        createdAt: event.ingestedAt,
        updatedAt: event.ingestedAt,
        deletedAt: null,
        queue: null,
      },
    ],
  };
  const service = createRouterService({ routingRepository: repository(null) });

  const decisions = service.decide(event, [rule]);

  expect(decisions).toHaveLength(2);
  expect(decisions[0]).toMatchObject({
    ruleVersion: 3,
    priority: "urgent",
    delivery: { kind: "queue", messageGroupId: "career" },
  });
  expect(decisions[1]).toMatchObject({
    delivery: { kind: "sse", streamKey: "triage" },
  });
});

test("an unmatched event uses the unclassified fallback and completes its outbox claim", async () => {
  const unclassified = queue("3", "unclassified");
  const fallback: RuleSnapshot = {
    id: "99",
    name: "system.unclassified",
    version: 1,
    pattern: { $default: true },
    priority: "normal",
    targets: [queueTarget("98", unclassified)],
  };
  const work: ClaimedRoutingWork = {
    event,
    leaseToken: "b48b2ccf-a3c8-4eed-bec3-bf44caab0711",
    attempts: 1,
    rules: [{ ...fallback, id: "10", name: "gmail", pattern: { source: ["gmail"] } }],
    defaultRule: fallback,
  };
  const routingRepository = repository(work);
  const service = createRouterService({ routingRepository });

  await expect(service.runOnce()).resolves.toMatchObject({
    status: "committed",
    eventId: "1",
    routesCreated: 1,
  });
  expect(routingRepository.commit).toHaveBeenCalledWith(
    "1",
    work.leaseToken,
    [expect.objectContaining({
      ruleId: "99",
      delivery: expect.objectContaining({ messageGroupId: "unclassified" }),
    })],
  );
});

test("invalid stored patterns are disabled and the outbox work is retried", async () => {
  const fallback: RuleSnapshot = {
    id: "99",
    name: "system.unclassified",
    version: 1,
    pattern: { $default: true },
    priority: "normal",
    targets: [queueTarget("98", queue("3", "unclassified"))],
  };
  const work: ClaimedRoutingWork = {
    event,
    leaseToken: "b48b2ccf-a3c8-4eed-bec3-bf44caab0711",
    attempts: 1,
    rules: [{ ...fallback, id: "10", pattern: { source: [{ suffix: "hub" }] } }],
    defaultRule: fallback,
  };
  const routingRepository = repository(work);
  const service = createRouterService({ routingRepository });

  await expect(service.runOnce()).resolves.toMatchObject({ status: "failed", eventId: "1" });
  expect(routingRepository.markRuleInvalid).toHaveBeenCalledWith(
    "10",
    1,
    expect.any(String),
  );
  expect(routingRepository.fail).toHaveBeenCalledOnce();
  expect(routingRepository.commit).not.toHaveBeenCalled();
});

test("a disabled target produces an explainable skip instead of a route", () => {
  const target = { ...queueTarget("20", queue("1", "career")), enabled: false };
  const rule: RuleSnapshot = {
    id: "10",
    name: "github.disabled",
    version: 1,
    pattern: { source: ["github"] },
    priority: "normal",
    targets: [target],
  };
  const service = createRouterService({ routingRepository: repository(null) });

  expect(service.decide(event, [rule])).toEqual([
    expect.objectContaining({
      target,
      delivery: { kind: "skipped", reason: "target_disabled" },
    }),
  ]);
});
