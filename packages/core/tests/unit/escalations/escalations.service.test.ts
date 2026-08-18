import type { ClaimedEscalation } from "database/escalations";
import { describe, expect, test, vi } from "vitest";
import {
  createEscalationsService,
  SmsDeliveryError,
} from "../../../src/escalations/escalations.service.js";

function escalation(overrides: Partial<ClaimedEscalation> = {}): ClaimedEscalation {
  return {
    id: "1",
    eventId: "101",
    queueId: "1",
    sourceMessageId: "201",
    routeId: null,
    targetTestId: null,
    reason: "ignored",
    receiveCount: 3,
    status: "sending",
    availableAt: "2026-08-17T10:00:00.000Z",
    lockedUntil: "2026-08-17T10:01:00.000Z",
    leaseToken: "00000000-0000-4000-8000-000000000001",
    attemptCount: 1,
    lastError: null,
    sentAt: null,
    smsSid: null,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    dismissedAt: null,
    event: {
      id: "101",
      source: "gmail",
      sourceEventId: "gmail-101",
      type: "security.alert",
      subject: "Sensitive subject",
      actor: "sender@example.com",
      summary: "Account security alert",
      occurredAt: "2026-08-17T08:00:00.000Z",
      ingestedAt: "2026-08-17T08:00:01.000Z",
      correlationId: null,
      causationEventId: null,
      traceId: null,
      detail: { gmailBody: "never include this" },
      attributes: { domain: "personal" },
      links: [],
    },
    ...overrides,
  };
}

function setup(send = vi.fn(async () => ({ sid: "SM123" }))) {
  const repository = {
    list: vi.fn(async () => []),
    listAttempts: vi.fn(async () => []),
    claimNext: vi.fn(async () => escalation()),
    reserveSendCapacity: vi.fn(async () => ({
      status: "reserved" as const,
      attemptCount: 1,
    })),
    markSent: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    rateLimit: vi.fn(async () => true),
    dismiss: vi.fn(async () => "updated" as const),
    retry: vi.fn(async () => "updated" as const),
  };
  const service = createEscalationsService(repository, { send }, {
    leaseSeconds: 60,
    maxAttempts: 5,
    rateLimitPerHour: 3,
    rateLimitPerDay: 10,
  }, {
    clock: () => new Date("2026-08-17T10:00:00.000Z"),
    random: () => 0,
  });
  return { service, repository, send };
}

describe("EscalationsService", () => {
  test("sends only bounded event summary data and records Twilio proof", async () => {
    const { service, repository, send } = setup();

    await expect(service.runOnce()).resolves.toBe("sent");
    expect(send).toHaveBeenCalledWith(
      "[events] URGENT ignored 3x (personal, 2h old):\nAccount security alert",
    );
    expect(send.mock.calls[0]?.[0]).not.toContain("never include this");
    expect(repository.markSent).toHaveBeenCalledWith(
      "1",
      "00000000-0000-4000-8000-000000000001",
      "SM123",
    );
  });

  test("describes routed and test SMS deliveries without claiming they were ignored", async () => {
    const routed = setup();
    routed.repository.claimNext.mockResolvedValue(escalation({
      sourceMessageId: null,
      routeId: "301",
    }));
    await routed.service.runOnce();
    expect(routed.send).toHaveBeenCalledWith(
      "[events] Routed event (personal, 2h old):\nAccount security alert",
    );

    const targetTest = setup();
    targetTest.repository.claimNext.mockResolvedValue(escalation({
      sourceMessageId: null,
      targetTestId: "401",
    }));
    await targetTest.service.runOnce();
    expect(targetTest.send).toHaveBeenCalledWith(
      "[events] SMS target test (personal, 2h old):\nAccount security alert",
    );
  });

  test("retries transient Twilio failures and stops permanent failures", async () => {
    const transient = setup(vi.fn(async () => {
      throw new SmsDeliveryError("rate limited", true, 120);
    }));
    await expect(transient.service.runOnce()).resolves.toBe("retry_scheduled");
    expect(transient.repository.markFailed).toHaveBeenCalledWith(
      "1",
      expect.any(String),
      expect.objectContaining({ retry: true, delaySeconds: 120 }),
    );

    const permanent = setup(vi.fn(async () => {
      throw new SmsDeliveryError("invalid number", false);
    }));
    await expect(permanent.service.runOnce()).resolves.toBe("failed");
    expect(permanent.repository.markFailed).toHaveBeenCalledWith(
      "1",
      expect.any(String),
      expect.objectContaining({ retry: false }),
    );
  });

  test("queues over-limit SMS without calling Twilio", async () => {
    const { service, repository, send } = setup();
    repository.reserveSendCapacity.mockResolvedValueOnce({
      status: "rate_limited",
      delaySeconds: 300,
    });

    await expect(service.runOnce()).resolves.toBe("rate_limited");
    expect(send).not.toHaveBeenCalled();
    expect(repository.rateLimit).toHaveBeenCalledWith("1", expect.any(String), 300);
  });

  test("uses only reserved sends when deciding the retry attempt", async () => {
    const transient = setup(vi.fn(async () => {
      throw new SmsDeliveryError("temporary", true);
    }));
    transient.repository.claimNext.mockResolvedValue(escalation({ attemptCount: 99 }));
    transient.repository.reserveSendCapacity.mockResolvedValue({
      status: "reserved",
      attemptCount: 2,
    });

    await expect(transient.service.runOnce()).resolves.toBe("retry_scheduled");
    expect(transient.repository.markFailed).toHaveBeenCalledWith(
      "1",
      expect.any(String),
      expect.objectContaining({ retry: true }),
    );
  });

  test("does not call Twilio after the reserved-send budget is exhausted", async () => {
    const { service, repository, send } = setup();
    repository.reserveSendCapacity.mockResolvedValue({
      status: "attempts_exhausted",
      attemptCount: 5,
    });

    await expect(service.runOnce()).resolves.toBe("failed");

    expect(send).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "1",
      expect.any(String),
      expect.objectContaining({ retry: false, delaySeconds: 0 }),
    );
  });
});
