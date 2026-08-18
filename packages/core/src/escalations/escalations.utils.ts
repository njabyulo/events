import type { ClaimedEscalation } from "database/escalations";
import { EscalationValidationError } from "./escalation.errors.js";

export class EscalationsUtils {
  static smsBody(escalation: ClaimedEscalation, now = new Date()): string {
    const ageMs = Math.max(0, now.getTime() - Date.parse(escalation.event.occurredAt));
    const ageMinutes = Math.max(1, Math.floor(ageMs / 60_000));
    const age = ageMinutes >= 60
      ? `${Math.floor(ageMinutes / 60)}h`
      : `${ageMinutes}m`;
    const domain = typeof escalation.event.attributes.domain === "string"
      ? escalation.event.attributes.domain
      : "unclassified";
    const summary = (escalation.event.summary || escalation.event.type)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320);
    return `[events] URGENT ignored ${escalation.receiveCount}x (${domain}, ${age} old):\n${summary}`;
  }

  static retryDelaySeconds(
    attempt: number,
    random = Math.random,
    baseSeconds = 30,
    maximumSeconds = 3_600,
  ): number {
    const exponent = Math.max(0, Math.min(attempt - 1, 20));
    const backoff = Math.min(maximumSeconds, baseSeconds * (2 ** exponent));
    return Math.min(maximumSeconds, backoff + Math.floor(random() * backoff * 0.2));
  }

  static boundedError(error: unknown): string {
    const value = error instanceof Error ? error.message : String(error ?? "SMS delivery failed");
    return value.replace(/\s+/g, " ").trim().slice(0, 500) || "SMS delivery failed";
  }

  static requiredText(value: unknown, field: string, maximum: number): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new EscalationValidationError(`${field} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maximum) {
      throw new EscalationValidationError(`${field} must be at most ${maximum} characters`);
    }
    return normalized;
  }
}
