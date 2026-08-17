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
  return {
    createReplay: vi.fn(async (input) => ({
      id: "9",
      requestedBy: input.requestedBy,
      reason: input.reason,
      eventFilter: input.eventFilter,
      ruleId: input.ruleId,
      ruleVersion: input.ruleVersion,
      status: "pending",
      eventsMatched: null,
      createdAt: event.ingestedAt,
      completedAt: null,
    })),
    getReplay: vi.fn(async () => ({
      id: "9",
      requestedBy: "njabulo",
      reason: "Incident review",
      eventFilter: { eventIds: ["42"] },
      ruleId: "5",
      ruleVersion: 2,
      status: "completed",
      eventsMatched: 1,
      createdAt: event.ingestedAt,
      completedAt: event.ingestedAt,
    })),
    listReplays: vi.fn(async () => []),
    setReplayStatus: vi.fn(async () => undefined),
    loadReplayEvents: vi.fn(async () => [event]),
    loadReplayRules: vi.fn(async () => rules),
    commitReplayEvent: vi.fn(async () => ({
      committed: true,
      routesCreated: 1,
      deliveriesCreated: 1,
      skipsRecorded: 0,
    })),
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
  })).resolves.toMatchObject({ id: "9", status: "completed", eventsMatched: 1 });
  expect(routingRepository.createReplay).toHaveBeenCalledWith(expect.objectContaining({
    ruleId: "5",
    ruleVersion: 2,
  }));
  expect(routingRepository.setReplayStatus).toHaveBeenNthCalledWith(1, "9", "running");
  expect(routingRepository.setReplayStatus).toHaveBeenNthCalledWith(2, "9", "completed", 1);
  expect(routingRepository.commitReplayEvent).toHaveBeenCalledOnce();
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
