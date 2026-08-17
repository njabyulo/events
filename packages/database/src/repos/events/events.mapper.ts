import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import type { EventLink, JsonObject, StoredEvent } from "./events.types.js";

export type EventRow = typeof eventsTable.$inferSelect;
export type EventLinkRow = typeof eventLinksTable.$inferSelect;

export type EventWithLinkRow = {
  event: EventRow;
  link: EventLinkRow | null;
};

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function toStoredEvent(
  event: EventRow,
  links: EventLink[] = [],
): StoredEvent {
  if (!event.occurred_at || !event.ingested_at) {
    throw new Error(`Event ${event.id} has invalid timestamps`);
  }

  return {
    id: String(event.id),
    source: event.source,
    sourceEventId: event.source_event_id,
    type: event.type,
    subject: event.subject,
    actor: event.actor,
    summary: event.summary,
    occurredAt: event.occurred_at.toISOString(),
    ingestedAt: event.ingested_at.toISOString(),
    correlationId: event.correlation_id,
    causationEventId: event.causation_event_id === null
      ? null
      : String(event.causation_event_id),
    traceId: event.trace_id,
    detail: asJsonObject(event.detail),
    attributes: asJsonObject(event.attributes),
    links,
  };
}

export function toStoredEvents(rows: EventWithLinkRow[]): StoredEvent[] {
  const events = new Map<number, { event: EventRow; links: EventLink[] }>();

  for (const row of rows) {
    const entry = events.get(row.event.id) ?? { event: row.event, links: [] };
    if (row.link) {
      entry.links.push({ kind: row.link.kind, value: row.link.value });
    }
    events.set(row.event.id, entry);
  }

  return [...events.values()].map(({ event, links }) => toStoredEvent(event, links));
}
