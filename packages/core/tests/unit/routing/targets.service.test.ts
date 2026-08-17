import { expect, test, vi } from "vitest";
import {
  createTargetsService,
  RoutingValidationError,
  type QueueRecord,
  type TargetRecord,
  type TargetsRepository,
} from "../../../src/routing/index.js";

const createdAt = "2026-08-16T12:00:00.000Z";
const queue: QueueRecord = {
  id: "1",
  name: "career",
  fifo: true,
  visibilityTimeoutSeconds: 30,
  maxReceiveCount: 3,
  retentionSeconds: 1_209_600,
  escalate: false,
  quietHours: true,
  digestFlushCron: null,
  createdAt,
  deletedAt: null,
};

function repository(): TargetsRepository {
  const targets = new Map<string, TargetRecord>();
  return {
    listTargets: vi.fn(async () => [...targets.values()]),
    getTarget: vi.fn(async (id) => targets.get(id) ?? null),
    listQueues: vi.fn(async () => [queue]),
    getQueue: vi.fn(async (id) => id === queue.id ? queue : null),
    streamKeyExists: vi.fn(async () => false),
    createTarget: vi.fn(async (input) => {
      const target: TargetRecord = {
        id: "10",
        ...input,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      };
      targets.set(target.id, target);
      return target;
    }),
    updateTarget: vi.fn(async () => null),
    setEnabled: vi.fn(async () => null),
    deleteTarget: vi.fn(async () => "not_found"),
    scheduleTargetTest: vi.fn(async () => "1"),
  };
}

test("queue target validates its queue and stores only the queue reference", async () => {
  const service = createTargetsService({
    targetsRepository: repository(),
    smsReadiness: {
      twilioCredentialsPresent: false,
      destinationPresent: false,
      rateLimitConfigured: false,
    },
  });

  await expect(service.createTarget({
    name: "career.queue",
    kind: "queue",
    config: { queueId: 1 },
    enabled: true,
  })).resolves.toMatchObject({ kind: "queue", config: { queueId: 1 } });
});

test("credentials are rejected before a target reaches the repository", async () => {
  const targetsRepository = repository();
  const service = createTargetsService({
    targetsRepository,
    smsReadiness: {
      twilioCredentialsPresent: true,
      destinationPresent: true,
      rateLimitConfigured: true,
    },
  });

  await expect(service.createTarget({
    name: "sms.escalation",
    kind: "sms",
    config: { authToken: "must-not-be-stored" },
    enabled: true,
  })).rejects.toMatchObject({ code: "credentials_not_allowed" });
  expect(targetsRepository.createTarget).not.toHaveBeenCalled();
});

test("defensively removes credential-shaped fields from target responses", async () => {
  const targetsRepository = repository();
  targetsRepository.listTargets = vi.fn(async () => [{
    id: "99",
    name: "legacy.target",
    kind: "sse",
    config: {
      streamKey: "triage",
      replayRetentionSeconds: 3_600,
      authToken: "legacy-secret",
      nested: { apiKey: "legacy-key", safe: "visible" },
    },
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  }]);
  const service = createTargetsService({
    targetsRepository,
    smsReadiness: {
      twilioCredentialsPresent: false,
      destinationPresent: false,
      rateLimitConfigured: false,
    },
  });

  await expect(service.listTargets()).resolves.toMatchObject([{
    config: {
      streamKey: "triage",
      replayRetentionSeconds: 3_600,
      nested: { safe: "visible" },
    },
  }]);
});

test("an SMS target cannot be enabled until environment readiness is complete", async () => {
  const targetsRepository = repository();
  const service = createTargetsService({
    targetsRepository,
    smsReadiness: {
      twilioCredentialsPresent: false,
      destinationPresent: false,
      rateLimitConfigured: false,
    },
  });

  await expect(service.createTarget({
    name: "sms.escalation",
    kind: "sms",
    config: {},
    enabled: true,
  })).rejects.toBeInstanceOf(RoutingValidationError);

  await service.createTarget({
    name: "sms.disabled",
    kind: "sms",
    config: {},
    enabled: false,
  });
  await expect(service.enableTarget("10")).rejects.toMatchObject({
    code: "sms_target_not_ready",
  });
  expect(targetsRepository.setEnabled).not.toHaveBeenCalled();
});

test("SSE target requires a URL-safe unique key and replay retention", async () => {
  const targetsRepository = repository();
  targetsRepository.streamKeyExists = vi.fn(async () => true);
  const service = createTargetsService({
    targetsRepository,
    smsReadiness: {
      twilioCredentialsPresent: false,
      destinationPresent: false,
      rateLimitConfigured: false,
    },
  });

  await expect(service.createTarget({
    name: "dashboard",
    kind: "sse",
    config: { streamKey: "triage", replayRetentionSeconds: 3_600 },
    enabled: false,
  })).rejects.toMatchObject({ code: "sse_stream_key_conflict" });
});
