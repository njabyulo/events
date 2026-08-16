import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  EventLink,
  EventToIngest,
  IngestEventResult,
  JsonObject,
  StoredEvent,
} from "./events.types.js";
import { db, type Database } from "../../client.js";
import {
  eventLinksTable,
  eventsTable,
  outboxTable,
  sourceCursorsTable,
} from "../../schemas/events.schema.js";

type EventRecord = typeof eventsTable.$inferSelect;
type EventLinkRecord = typeof eventLinksTable.$inferSelect;

const EVENTS_LIST_LIMIT = 100;

export type EventsRepoDependencies = {
  database: Database;
  eventsChannel: string;
};

export type CreateEventsRepoOptions = Partial<EventsRepoDependencies>;

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function linksByEvent(records: EventLinkRecord[]): Map<number, EventLink[]> {
  const links = new Map<number, EventLink[]>();

  for (const record of records) {
    const eventLinks = links.get(record.event_id) ?? [];
    eventLinks.push({ kind: record.kind, value: record.value });
    links.set(record.event_id, eventLinks);
  }

  return links;
}

function toStoredEvent(event: EventRecord, links: EventLink[] = []): StoredEvent {
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

function resolveEventsChannel(value: string | undefined): string {
  const channel = value || "events_ready";
  if (!/^[a-z_][a-z0-9_$]*$/i.test(channel)) {
    throw new Error("EVENTS_CHANNEL must be a valid PostgreSQL identifier");
  }
  return channel;
}

export class EventsRepo {
  constructor(private readonly dependencies: EventsRepoDependencies) {}

  async getEvents(): Promise<StoredEvent[]> {
    const events = await this.dependencies.database
      .select()
      .from(eventsTable)
      .orderBy(desc(eventsTable.occurred_at), desc(eventsTable.id))
      .limit(EVENTS_LIST_LIMIT);

    if (events.length === 0) return [];

    const linkRecords = await this.dependencies.database
      .select()
      .from(eventLinksTable)
      .where(inArray(eventLinksTable.event_id, events.map((event) => event.id)));
    const links = linksByEvent(linkRecords);

    return events.map((event) => toStoredEvent(event, links.get(event.id)));
  }

  async getEventById(id: string): Promise<StoredEvent | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const [event] = await this.dependencies.database
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, numericId))
      .limit(1);

    if (!event) return null;

    const linkRecords = await this.dependencies.database
      .select()
      .from(eventLinksTable)
      .where(eq(eventLinksTable.event_id, numericId));

    return toStoredEvent(event, linksByEvent(linkRecords).get(numericId));
  }

  async ingestEvent(event: EventToIngest): Promise<IngestEventResult> {
    return this.dependencies.database.transaction(async (transaction) => {
      const [insertedEvent] = await transaction
        .insert(eventsTable)
        .values({
          source: event.source,
          source_event_id: event.sourceEventId,
          type: event.type,
          subject: event.subject,
          actor: event.actor,
          summary: event.summary,
          occurred_at: new Date(event.occurredAt),
          correlation_id: event.correlationId,
          causation_event_id: event.causationEventId === null
            ? null
            : Number(event.causationEventId),
          trace_id: event.traceId,
          detail: event.detail,
          attributes: event.attributes,
        })
        .onConflictDoNothing({
          target: [eventsTable.source, eventsTable.source_event_id],
        })
        .returning({ id: eventsTable.id });

      let id = insertedEvent?.id;
      const inserted = id !== undefined;

      if (id === undefined) {
        const [existingEvent] = await transaction
          .select({ id: eventsTable.id })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.source, event.source),
            eq(eventsTable.source_event_id, event.sourceEventId),
          ))
          .limit(1);

        id = existingEvent?.id;
      }

      if (id === undefined) {
        throw new Error("Event insert did not return or resolve an event ID");
      }

      if (!inserted) {
        return {
          id: String(id),
          sourceEventId: event.sourceEventId,
          inserted: false,
        };
      }

      if (event.links.length > 0) {
        await transaction.insert(eventLinksTable).values(
          event.links.map((link) => ({
            event_id: id,
            kind: link.kind,
            value: link.value,
          })),
        );
      }

      await transaction.insert(outboxTable).values({ event_id: id });

      await transaction.execute(sql`select pg_notify(
        ${this.dependencies.eventsChannel},
        ${String(id)}
      )`);

      return {
        id: String(id),
        sourceEventId: event.sourceEventId,
        inserted: true,
      };
    });
  }

  async getSourceCursor(source: string, key: string): Promise<string | null> {
    const [record] = await this.dependencies.database
      .select({ cursor: sourceCursorsTable.cursor })
      .from(sourceCursorsTable)
      .where(and(
        eq(sourceCursorsTable.source, source),
        eq(sourceCursorsTable.key, key),
      ))
      .limit(1);

    return record?.cursor ?? null;
  }

  async setSourceCursor(source: string, key: string, cursor: string): Promise<void> {
    await this.dependencies.database
      .insert(sourceCursorsTable)
      .values({ source, key, cursor })
      .onConflictDoUpdate({
        target: [sourceCursorsTable.source, sourceCursorsTable.key],
        set: { cursor, updated_at: new Date() },
      });
  }
}

export const createEventsRepo = (
  options: CreateEventsRepoOptions = {},
): EventsRepo => new EventsRepo({
  database: options.database ?? db,
  eventsChannel: resolveEventsChannel(
    options.eventsChannel ?? process.env.EVENTS_CHANNEL,
  ),
});

export const eventsRepo = createEventsRepo();
