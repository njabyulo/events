import type { StoredEvent } from "database/events";
import type { TriageDecisionRecord } from "database/triage";

const LINK_PRIORITY = [
  "thread_key",
  "thread_id",
  "pull_request",
  "issue",
  "deployment_id",
  "workflow_run",
  "repository",
  "commit_sha",
] as const;

export class TriageUtils {
  static decide(event: StoredEvent, queueName: string): TriageDecisionRecord {
    const classifiedBy = event.attributes.classifiedBy;
    const agentDomain = event.attributes.domain;
    const agentPriority = event.attributes.priority;
    if (
      typeof classifiedBy === "string"
      && (agentDomain === "career" || agentDomain === "personal")
      && (agentPriority === "urgent" || agentPriority === "normal" || agentPriority === "low")
    ) {
      const channel = event.attributes.channel;
      return {
        domain: agentDomain,
        priority: agentPriority,
        channel: channel === "telegram" || channel === "sms" || channel === "digest"
          ? channel
          : "web",
        brief: TriageUtils.brief(event),
        decidedBy: "strands-agent",
        reason: typeof event.attributes.reason === "string"
          ? event.attributes.reason.slice(0, 500)
          : `strands-agent:${classifiedBy}`,
      };
    }
    const source = event.source.toLowerCase();
    const domain = /(^|[._-])personal($|[._-])/.test(source)
      ? "personal"
      : /(^|[._-])career($|[._-])/.test(source)
        ? "career"
        : source.startsWith("github")
          ? "career"
          : source.startsWith("gmail")
            ? "personal"
            : ["career", "personal"].includes(queueName)
              ? queueName
              : "unclassified";
    const priority = TriageUtils.priority(event.source, event.type);
    return {
      domain,
      priority,
      channel: priority === "low" ? "digest" : "web",
      brief: TriageUtils.brief(event),
      decidedBy: "rule-stub",
      reason: `rule-stub:${event.source}:${event.type}`,
    };
  }

  static threadKey(event: StoredEvent): string {
    for (const kind of LINK_PRIORITY) {
      const link = event.links.find((candidate) => candidate.kind === kind);
      if (!link) continue;
      if (kind === "thread_key") return link.value.slice(0, 1_000);
      const suffix = kind === "repository"
        ? `:${event.subject?.trim() || event.type}`
        : "";
      return `${event.source}:${kind}:${link.value}${suffix}`.slice(0, 1_000);
    }
    if (event.correlationId) return `${event.source}:correlation:${event.correlationId}`;
    if (event.subject) return `${event.source}:subject:${event.subject}`.slice(0, 1_000);
    return `${event.source}:event:${event.id}`;
  }

  static title(event: StoredEvent): string {
    return (event.subject?.trim() || event.summary?.trim() || event.type).slice(0, 240);
  }

  private static priority(source: string, type: string): TriageDecisionRecord["priority"] {
    const normalized = `${source}.${type}`.toLowerCase();
    if (
      normalized.includes("failure")
      || normalized.includes("failed")
      || normalized.includes("alarm")
      || normalized.includes("security")
      || normalized.endsWith("pull_request.review_requested")
    ) return "urgent";
    if (
      normalized.endsWith(".push")
      || normalized.includes("branch.created")
      || normalized.includes("branch.updated")
      || normalized.includes("branch.deleted")
      || normalized.includes("pull_request.merged")
      || normalized.includes("newsletter")
    ) return "low";
    return "normal";
  }

  private static brief(event: StoredEvent): string {
    const value = event.summary?.trim()
      || [event.actor, event.type, event.subject].filter(Boolean).join(" · ");
    return (value || event.type).replace(/\s+/g, " ").slice(0, 280);
  }
}
