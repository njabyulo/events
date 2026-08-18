import type { JsonObject, StoredEvent } from "../events/events.types.js";

export type Priority = "urgent" | "normal" | "low";
export type TargetKind = "queue" | "sse" | "sms";
export type RulePattern = JsonObject;

export type RuleVersionRecord = {
  ruleId: string;
  version: number;
  pattern: RulePattern;
  priority: Priority;
  createdAt: string;
};

export type RuleRecord = {
  id: string;
  name: string;
  enabled: boolean;
  currentVersion: number;
  version: RuleVersionRecord;
  targetIds: string[];
  validationError: string | null;
  invalidAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type QueueRecord = {
  id: string;
  name: string;
  fifo: boolean;
  visibilityTimeoutSeconds: number;
  maxReceiveCount: number;
  retentionSeconds: number;
  escalate: boolean;
  quietHours: boolean;
  digestFlushCron: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type TargetRecord = {
  id: string;
  name: string;
  kind: TargetKind;
  config: JsonObject;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TargetSnapshot = TargetRecord & {
  queue: QueueRecord | null;
};

export type RuleSnapshot = {
  id: string;
  name: string;
  version: number;
  pattern: RulePattern;
  priority: Priority;
  targets: TargetSnapshot[];
};

export type ClaimedRoutingWork = {
  event: StoredEvent;
  leaseToken: string;
  attempts: number;
  rules: RuleSnapshot[];
  defaultRule: RuleSnapshot;
};

export type RoutingDelivery =
  | {
    kind: "queue";
    queueId: string;
    messageGroupId: string;
    visibleAt: string;
  }
  | { kind: "sse"; streamKey: string }
  | { kind: "sms" }
  | { kind: "skipped"; reason: string };

export type RoutingDecision = {
  ruleId: string;
  ruleVersion: number;
  rulePattern: RulePattern;
  priority: Priority;
  target: TargetSnapshot;
  delivery: RoutingDelivery;
};

export type CommitRoutingResult = {
  committed: boolean;
  routesCreated: number;
  deliveriesCreated: number;
  skipsRecorded: number;
};

export type EventRouteRecord = {
  id: string;
  eventId: string;
  ruleId: string;
  ruleVersion: number;
  targetId: string;
  replayId: string | null;
  priority: Priority;
  rulePattern: RulePattern;
  targetKind: TargetKind;
  targetConfig: JsonObject;
  routedAt: string;
};

export type EventRoutingSkipRecord = {
  id: string;
  eventId: string;
  ruleId: string;
  ruleVersion: number;
  targetId: string;
  replayId: string | null;
  reason: string;
  recordedAt: string;
};

export type ReplayFilter = {
  source?: string[];
  type?: string[];
  from?: string;
  to?: string;
  eventIds?: string[];
};

export type ReplayRecord = {
  id: string;
  requestedBy: string;
  reason: string;
  eventFilter: ReplayFilter;
  ruleId: string | null;
  ruleVersion: number | null;
  status: "pending" | "running" | "completed" | "failed";
  eventsMatched: number;
  attempts: number;
  lastEventId: string | null;
  lockedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ClaimedReplay = ReplayRecord & {
  leaseToken: string;
};
