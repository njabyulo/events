import { expect, test, vi } from "vitest";
import {
  createReplaysService,
  RoutingNotFoundError,
  type ReplaysRepository,
  type RuleSnapshot,
  type StoredEvent,
} from "../../../src/routing/index.js";

const event: StoredEvent = {
  id: "42",
  source: "github",
  sourceEventId: "delivery-42",
  type: "push.created",
  subject: null,
  actor: null,
  summary: "Pushed commit",
  occurredAt: "2026-08-16T12:00:00.000Z",
  ingestedAt: "2026-08-16T12:00:01.000Z",
  correlationId: null,
  causationEventId: null,
  traceId: null,
  detail: {},
  attributes: {},
  links: [],
};

const rule: RuleSnapshot = {
  id: "5",
  name: "github.replay",
  version: 2,
  pattern: { source: ["github"] },
  priority: "normal",
  targets: [],
};

function repository(rules: RuleSnapshot[] = [rule]): ReplaysRepository {
  const replay = {
    id: "9",
    requestedBy: "njabulo",
    reason: "Incident review",
    eventFilter: { eventIds: ["42"] },
    ruleId: "5",
    ruleVersion: 2,
    status: "pending" as const,
    eventsMatched: 0,
    attempts: 0,
    lastEventId: null,
    lockedUntil: null,
    lastError: null,
    createdAt: event.ingestedAt,
    updatedAt: event.ingestedAt,
    completedAt: null,
  };
  return {
    createReplay: vi.fn(async (input) => ({
      ...replay,
      requestedBy: input.requestedBy,
      reason: input.reason,
      eventFilter: input.eventFilter,
      ruleId: input.ruleId,
      ruleVersion: input.ruleVersion,
    })),
    getReplay: vi.fn(async () => replay),
    listReplays: vi.fn(async () => []),
    claimReplay: vi.fn(async () => ({
      ...replay,
      status: "running" as const,
      attempts: 1,
      leaseToken: "lease-9",
    })),
    loadReplayEvents: vi.fn(async () => [event]),
    loadReplayRules: vi.fn(async () => rules),
    commitReplayBatch: vi.fn(async () => true),
    failReplay: vi.fn(async () => true),
  };
}

test("replay pins a rule version, audits through creation, and records filter matches", async () => {
  const routingRepository = repository();
  const routerService = {
    decide: vi.fn(() => [{
      ruleId: "5",
      ruleVersion: 2,
      rulePattern: rule.pattern,
      priority: "normal" as const,
      target: {
        id: "10",
        name: "career.queue",
        kind: "queue" as const,
        config: { queueId: 1 },
        enabled: true,
        createdAt: event.ingestedAt,
        updatedAt: event.ingestedAt,
        deletedAt: null,
        queue: null,
      },
      delivery: { kind: "queue" as const, queueId: "1", messageGroupId: "career", visibleAt: event.ingestedAt },
    }]),
  };
  const service = createReplaysService({ routingRepository, routerService });

  await expect(service.createReplay({
    requestedBy: "njabulo",
    reason: "Incident review",
    eventFilter: { eventIds: ["42"] },
    ruleId: "5",
    ruleVersion: 2,
  })).resolves.toMatchObject({ id: "9", status: "pending", eventsMatched: 0 });
  expect(routingRepository.createReplay).toHaveBeenCalledWith(expect.objectContaining({
    ruleId: "5",
    ruleVersion: 2,
  }));
  await expect(service.runOnce()).resolves.toEqual({
    status: "batch_committed",
    replayId: "9",
    eventCount: 1,
    completed: true,
  });
  expect(routingRepository.claimReplay).toHaveBeenCalledWith(60);
  expect(routingRepository.commitReplayBatch).toHaveBeenCalledWith(
    "9",
    "lease-9",
    [{ eventId: "42", decisions: expect.any(Array) }],
    true,
  );
});

test("replay refuses a missing pinned rule version before creating an audit", async () => {
  const routingRepository = repository([]);
  const service = createReplaysService({
    routingRepository,
    routerService: { decide: vi.fn(() => []) },
  });

  await expect(service.createReplay({
    requestedBy: "njabulo",
    reason: "Incident review",
    eventFilter: { eventIds: ["42"] },
    ruleId: "5",
    ruleVersion: 99,
  })).rejects.toBeInstanceOf(RoutingNotFoundError);
  expect(routingRepository.createReplay).not.toHaveBeenCalled();
});
