import type { StoredEvent } from "database/events";
import type { Priority } from "database/queues";
import type { ThreadRecord, TriageDecisionRecord } from "database/triage";

export type AgentDomain = "career" | "personal";

export type AgentClassification = {
  domain: AgentDomain;
  priority: Priority;
  confidence: number;
  reason: string;
  matchedThreadKey: string | null;
};

export type AgentEventInput = Pick<StoredEvent,
  "id" | "source" | "type" | "subject" | "actor" | "summary" | "occurredAt" | "links"
>;

export type AgentThreadCandidate = Pick<ThreadRecord,
  "id" | "threadKey" | "domain" | "title" | "brief" | "lastEventAt"
>;

export type AgentReplyInput = {
  thread: AgentThreadCandidate;
  history: AgentEventInput[];
  actor: string | null;
  message: string;
};

export interface TriageAgentClient {
  classify(input: {
    event: AgentEventInput;
    candidateThreads: AgentThreadCandidate[];
  }): Promise<AgentClassification>;
  reply(input: AgentReplyInput): Promise<{ message: string; reason: string }>;
}

export type AgentConsumeResult =
  | { status: "published"; eventId: string; duplicate: boolean }
  | { status: "human"; decision: TriageDecisionRecord; threadKey: string }
  | { status: "loop_skipped" };
