import type { Priority, StoredEvent } from "../routing/index.js";

export type TriageStatus = "pending" | "snoozed" | "acked";

export type TriageItemRecord = {
  id: string;
  streamKey: string;
  consumerName: string;
  queueMessageId: string;
  queueId: string;
  eventId: string;
  domain: string;
  priority: Priority;
  status: TriageStatus;
  receiptHandle: string | null;
  visibleUntil: string | null;
  createdAt: string;
  updatedAt: string;
  ackedAt: string | null;
  event: StoredEvent;
};

export type StreamMessageRecord = {
  id: string;
  streamKey: string;
  eventName: string;
  eventId: string;
  routeId: string | null;
  triageItem: TriageItemRecord | null;
  data: Record<string, unknown>;
  createdAt: string;
  event: StoredEvent;
};

export type TriageActionResult = "updated" | "stale" | "not_found";
