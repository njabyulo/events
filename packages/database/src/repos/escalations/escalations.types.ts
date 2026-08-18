import type { StoredEvent } from "../events/events.types.js";

export type EscalationStatus = "pending" | "sending" | "sent" | "failed" | "dismissed";

export type EscalationRecord = {
  id: string;
  eventId: string;
  queueId: string;
  sourceMessageId: string;
  reason: string;
  receiveCount: number;
  status: EscalationStatus;
  availableAt: string;
  lockedUntil: string | null;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  smsSid: string | null;
  createdAt: string;
  updatedAt: string;
  dismissedAt: string | null;
  event: StoredEvent;
};

export type ClaimedEscalation = EscalationRecord & {
  leaseToken: string;
};

export type EscalationAttemptRecord = {
  id: string;
  escalationId: string;
  attemptNumber: number;
  outcome: "send_reserved" | "sent" | "retry_scheduled" | "failed" | "rate_limited";
  smsSid: string | null;
  error: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
};

export type EscalationActionResult = "updated" | "stale" | "not_found";

export type SendCapacityReservation =
  | { status: "reserved"; attemptCount: number }
  | { status: "rate_limited"; delaySeconds: number }
  | { status: "attempts_exhausted"; attemptCount: number }
  | { status: "lease_lost" };
