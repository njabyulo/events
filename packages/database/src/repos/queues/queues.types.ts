import type { StoredEvent } from "../events/events.types.js";
import type { Priority, QueueRecord } from "../routing/routing.types.js";

export type { Priority, QueueRecord, StoredEvent };

export type QueueMessageRecord = {
  id: string;
  queueId: string;
  eventId: string;
  routeId: string | null;
  messageGroupId: string;
  priority: Priority;
  visibleAt: string;
  receiptHandle: string | null;
  receiveCount: number;
  enqueuedAt: string;
  lastError: string | null;
};

export type ReceivedQueueMessage = QueueMessageRecord & {
  queueName: string;
  visibleUntil: string;
  event: StoredEvent;
};

export type MessageAttemptRecord = {
  id: string;
  messageId: string;
  queueId: string;
  eventId: string;
  consumerName: string | null;
  receiptHandle: string | null;
  receiveCount: number;
  outcome: "received" | "acked" | "nacked" | "released" | "visibility_extended" | "snoozed" | "escalated" | "dead_lettered" | "expired";
  visibleUntil: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
};

export type QueueMaintenanceResult = {
  deadLettered: number;
  expired: number;
};

export type DeadLetterMessageRecord = {
  id: string;
  originalMessageId: string;
  queueId: string;
  eventId: string;
  routeId: string | null;
  messageGroupId: string;
  priority: Priority;
  receiveCount: number;
  reason: string;
  lastError: string | null;
  enqueuedAt: string;
  deadLetteredAt: string;
  event: StoredEvent;
};

export type QueueStats = {
  queueId: string;
  visible: number;
  delayed: number;
  inFlight: number;
  oldestVisibleAt: string | null;
};
