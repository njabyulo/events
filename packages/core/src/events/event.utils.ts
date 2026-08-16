import { randomUUID } from "node:crypto";
import type { EventLink, EventToIngest, JsonObject } from "database/events";
import type { EventEnvelope, EventValidationLimits } from "./events.service.js";

export class EventValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EventValidationError";
  }
}

export class EventsUtils {
  static readonly DEFAULT_VALIDATION_LIMITS: EventValidationLimits = {
    detailBytes: 262_144,
    maxLinks: 25,
    linkKindLength: 64,
    linkValueLength: 512,
  };

  private static readonly SOURCE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
  private static readonly TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
  private static readonly LINK_KIND_PATTERN = /^[a-z][a-z0-9_]*$/;

  static isValidEventId(id: string): boolean {
    return /^\d+$/.test(id) && BigInt(id) > 0n;
  }

  static normalizeEnvelope(
    envelope: EventEnvelope,
    limits: EventValidationLimits = EventsUtils.DEFAULT_VALIDATION_LIMITS,
  ): EventToIngest {
    const source = EventsUtils.requiredString(envelope.source, "source", 128);
    if (!EventsUtils.SOURCE_PATTERN.test(source)) {
      throw new EventValidationError(
        "invalid_source",
        "source must be a lowercase namespaced identifier",
      );
    }

    const type = EventsUtils.requiredString(envelope.type, "type", 160);
    if (!EventsUtils.TYPE_PATTERN.test(type)) {
      throw new EventValidationError(
        "invalid_event_type",
        "type must be a lowercase dotted identifier",
      );
    }

    const occurredAtValue = EventsUtils.requiredString(
      envelope.occurredAt,
      "occurredAt",
      64,
    );
    const occurredAt = new Date(occurredAtValue);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new EventValidationError(
        "invalid_occurred_at",
        "occurredAt must be a valid timestamp",
      );
    }

    const detail = EventsUtils.jsonObject(envelope.detail, "detail");
    if (EventsUtils.jsonBytes(detail) > limits.detailBytes) {
      throw new EventValidationError(
        "event_detail_too_large",
        `detail cannot exceed ${limits.detailBytes} bytes`,
      );
    }

    return {
      source,
      sourceEventId: envelope.sourceEventId === undefined
        ? randomUUID()
        : EventsUtils.requiredString(envelope.sourceEventId, "sourceEventId", 255),
      type,
      subject: EventsUtils.optionalString(envelope.subject, "subject", 500),
      actor: EventsUtils.optionalString(envelope.actor, "actor", 320),
      summary: EventsUtils.optionalString(envelope.summary, "summary", 1_000),
      occurredAt: occurredAt.toISOString(),
      correlationId: EventsUtils.optionalString(
        envelope.correlationId,
        "correlationId",
        255,
      ),
      causationEventId: EventsUtils.causationId(envelope.causationEventId),
      traceId: EventsUtils.optionalString(envelope.traceId, "traceId", 255),
      detail,
      attributes: envelope.attributes === undefined
        ? {}
        : EventsUtils.jsonObject(envelope.attributes, "attributes"),
      links: EventsUtils.normalizeLinks(envelope.links, limits),
    };
  }

  private static requiredString(
    value: unknown,
    field: string,
    maxLength: number,
  ): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new EventValidationError("invalid_event", `${field} is required`);
    }

    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw new EventValidationError("invalid_event", `${field} is too long`);
    }
    return normalized;
  }

  private static optionalString(
    value: unknown,
    field: string,
    maxLength: number,
  ): string | null {
    if (value === undefined || value === null) return null;
    return EventsUtils.requiredString(value, field, maxLength);
  }

  private static jsonObject(value: unknown, field: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new EventValidationError("invalid_event", `${field} must be a JSON object`);
    }
    return value as JsonObject;
  }

  private static jsonBytes(value: JsonObject): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      throw new EventValidationError("invalid_event", "detail must be JSON serializable");
    }
  }

  private static causationId(value: unknown): string | null {
    if (value === undefined || value === null) return null;

    const normalized = typeof value === "number" ? String(value) : value;
    if (
      typeof normalized !== "string"
      || !/^\d+$/.test(normalized)
      || !Number.isSafeInteger(Number(normalized))
      || Number(normalized) <= 0
    ) {
      throw new EventValidationError(
        "invalid_causation_event_id",
        "causationEventId must be a positive event ID",
      );
    }

    return normalized;
  }

  private static normalizeLinks(
    value: unknown,
    limits: EventValidationLimits,
  ): EventLink[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new EventValidationError("invalid_event_links", "links must be an array");
    }
    if (value.length > limits.maxLinks) {
      throw new EventValidationError(
        "invalid_event_links",
        `links cannot contain more than ${limits.maxLinks} items`,
      );
    }

    const unique = new Map<string, EventLink>();
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new EventValidationError("invalid_event_links", "every link must be an object");
      }
      const record = item as Record<string, unknown>;
      const kind = EventsUtils.requiredString(
        record.kind,
        "links.kind",
        limits.linkKindLength,
      );
      const linkValue = EventsUtils.requiredString(
        record.value,
        "links.value",
        limits.linkValueLength,
      );
      if (!EventsUtils.LINK_KIND_PATTERN.test(kind)) {
        throw new EventValidationError(
          "invalid_event_links",
          "links.kind must be a lowercase identifier",
        );
      }
      unique.set(`${kind}\0${linkValue}`, { kind, value: linkValue });
    }

    return [...unique.values()];
  }
}
