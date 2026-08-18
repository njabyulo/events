import type { Priority, StoredEvent } from "../routing/index.js";

export type TriageStatus = "pending" | "snoozed" | "acked";
export type ThreadStatus = "open" | "snoozed" | "acked";
export type TriageChannel = "web" | "digest" | "telegram" | "sms";

export type TriageDecisionRecord = {
  domain: string;
  priority: Priority;
  channel: TriageChannel;
  brief: string;
  decidedBy: "rule-stub" | "strands-agent";
  reason: string;
};

export type TriageItemRecord = {
  id: string;
  streamKey: string;
  consumerName: string;
  queueMessageId: string;
  queueId: string;
  eventId: string;
  threadId: string | null;
  domain: string;
  priority: Priority;
  channel: TriageChannel;
  brief: string;
  decidedBy: string;
  decisionReason: string;
  status: TriageStatus;
  receiptHandle: string | null;
  visibleUntil: string | null;
  createdAt: string;
  updatedAt: string;
  ackedAt: string | null;
  event: StoredEvent;
};

export type ThreadRecord = {
  id: string;
  threadKey: string;
  domain: string;
  priority: Priority;
  channel: TriageChannel;
  title: string;
  brief: string;
  decidedBy: string;
  decisionReason: string;
  status: ThreadStatus;
  firstEventAt: string;
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
  ackedAt: string | null;
  pendingItemCount: number;
  messages: StoredEvent[];
};

export type ThreadSummaryRecord = Omit<ThreadRecord, "messages">;

export type StreamMessageRecord = {
  id: string;
  streamKey: string;
  eventName: string;
  eventId: string;
  routeId: string | null;
  threadId: string | null;
  triageItem: Omit<TriageItemRecord, "event"> | null;
  data: Record<string, unknown>;
  createdAt: string;
  event: Pick<StoredEvent,
    | "id"
    | "source"
    | "sourceEventId"
    | "type"
    | "subject"
    | "actor"
    | "summary"
    | "occurredAt"
    | "ingestedAt"
    | "correlationId"
    | "causationEventId"
    | "traceId"
  >;
};

export type TriageActionResult = "updated" | "stale" | "not_found";
