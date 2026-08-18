import type { EventEnvelope } from "../events/events.service.js";
import { TriageUtils } from "../triage/triage.utils.js";
import type {
  AgentClassification,
  AgentConsumeResult,
  AgentEventInput,
  AgentThreadCandidate,
} from "./agent.types.js";
import type { StoredEvent } from "database/events";
import type { ThreadRecord, ThreadSummaryRecord, TriageDecisionRecord } from "database/triage";
import { AgentValidationError } from "./agent.errors.js";

export class AgentUtils {
  static eventInput(event: StoredEvent): AgentEventInput {
    return {
      id: event.id,
      source: event.source,
      type: event.type,
      subject: event.subject,
      actor: event.actor,
      summary: event.summary,
      occurredAt: event.occurredAt,
      links: event.links,
    };
  }

  static threadCandidates(threads: ThreadSummaryRecord[], maximum = 20): AgentThreadCandidate[] {
    return threads.slice(0, maximum).map((thread) => ({
      id: thread.id,
      threadKey: thread.threadKey,
      domain: thread.domain,
      title: thread.title,
      brief: thread.brief,
      lastEventAt: thread.lastEventAt,
    }));
  }

  static replyHistory(
    messages: StoredEvent[],
    maximumEvents: number,
    maximumCharacters: number,
  ): AgentEventInput[] {
    const history: AgentEventInput[] = [];
    let characters = 0;
    for (let index = messages.length - 1; index >= 0 && history.length < maximumEvents; index -= 1) {
      const input = AgentUtils.eventInput(messages[index]!);
      const size = JSON.stringify(input).length;
      if (history.length > 0 && characters + size > maximumCharacters) break;
      history.push(input);
      characters += size;
    }
    return history.reverse();
  }

  static classificationEnvelope(
    event: StoredEvent,
    classification: AgentClassification,
    candidates: AgentThreadCandidate[],
    model: string,
    now: Date,
  ): EventEnvelope {
    const baseline = TriageUtils.decide(event, "unclassified");
    const matched = candidates.find(
      ({ threadKey }) => threadKey === classification.matchedThreadKey,
    );
    const threadKey = matched?.threadKey ?? TriageUtils.threadKey(event);
    const channel = classification.priority === "urgent"
      ? "telegram"
      : classification.priority === "low"
        ? "digest"
        : "web";
    const links = AgentUtils.uniqueLinks([
      { kind: "thread_key", value: threadKey },
      ...(matched ? [{ kind: "thread_id", value: matched.id }] : []),
      ...event.links,
    ]);
    const decision = {
      domain: classification.domain,
      priority: classification.priority,
      channel,
    };
    return {
      source: "classifier",
      sourceEventId: `classified-${event.id}`,
      type: event.type,
      subject: event.subject,
      actor: event.actor,
      summary: event.summary,
      occurredAt: event.occurredAt,
      correlationId: event.correlationId,
      causationEventId: event.id,
      traceId: event.traceId,
      detail: { originalEventId: event.id },
      attributes: {
        classifiedBy: "strands-agent",
        model,
        ...decision,
        confidence: classification.confidence,
        reason: classification.reason,
        baselineDecision: baseline,
        decisionDiff: AgentUtils.decisionDiff(baseline, decision),
        evaluatedAt: now.toISOString(),
        actions: [
          { label: "Review", value: `event.review:${event.id}` },
          { label: "Snooze", value: `event.snooze:${event.id}` },
        ],
      },
      links,
    };
  }

  static humanDecision(
    event: StoredEvent,
    classification: AgentClassification,
  ): Extract<AgentConsumeResult, { status: "human" }> {
    return {
      status: "human",
      threadKey: TriageUtils.threadKey(event),
      decision: {
        domain: "unclassified",
        priority: "normal",
        channel: "web",
        brief: (event.summary || event.type).replace(/\s+/g, " ").slice(0, 280),
        decidedBy: "strands-agent",
        reason: `low-confidence:${classification.confidence.toFixed(2)}:${classification.reason}`
          .slice(0, 500),
      },
    };
  }

  static replyEnvelope(
    event: StoredEvent,
    thread: ThreadRecord,
    reply: { message: string; reason: string },
    model: string,
    now: Date,
  ): EventEnvelope {
    const priority = thread.priority;
    return {
      source: "agent",
      sourceEventId: `thread-response-${event.id}`,
      type: "thread.agent_response",
      subject: thread.title,
      actor: "strands-agent",
      summary: reply.message,
      occurredAt: now.toISOString(),
      correlationId: event.correlationId,
      causationEventId: event.id,
      traceId: event.traceId,
      detail: { replyToEventId: event.id },
      attributes: {
        classifiedBy: "strands-agent",
        model,
        domain: ["career", "personal", "unclassified"].includes(thread.domain)
          ? thread.domain
          : "unclassified",
        priority,
        channel: "web",
        confidence: 1,
        reason: reply.reason,
        role: "agent",
      },
      links: AgentUtils.uniqueLinks([
        { kind: "thread_key", value: thread.threadKey },
        { kind: "thread_id", value: thread.id },
      ]),
    };
  }

  static userReplyEnvelope(
    thread: ThreadRecord,
    actor: string,
    message: string,
    now: Date,
  ): EventEnvelope {
    const lastEvent = thread.messages.at(-1);
    return {
      source: "dashboard",
      sourceEventId: `thread-reply-${thread.id}-${crypto.randomUUID()}`,
      type: "thread.reply",
      subject: thread.title,
      actor,
      summary: message,
      occurredAt: now.toISOString(),
      correlationId: null,
      causationEventId: lastEvent?.id ?? null,
      traceId: lastEvent?.traceId ?? null,
      detail: {},
      attributes: { role: "user", threadId: thread.id },
      links: [
        { kind: "thread_key", value: thread.threadKey },
        { kind: "thread_id", value: thread.id },
      ],
    };
  }

  static decisionDiff(
    baseline: TriageDecisionRecord,
    model: Pick<AgentClassification, "domain" | "priority"> & { channel: string },
  ): string[] {
    return (["domain", "priority", "channel"] as const)
      .filter((key) => baseline[key] !== model[key]);
  }

  static requiredReply(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AgentValidationError("message is required");
    }
    if (value.trim().length > 2_000) {
      throw new AgentValidationError("message must be at most 2000 characters");
    }
    return value.trim();
  }

  static requiredActor(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AgentValidationError("actor is required");
    }
    if (value.trim().length > 120) {
      throw new AgentValidationError("actor must be at most 120 characters");
    }
    return value.trim();
  }

  private static uniqueLinks(links: Array<{ kind: string; value: string }>) {
    return [...new Map(links.map((link) => [`${link.kind}:${link.value}`, link])).values()];
  }
}
