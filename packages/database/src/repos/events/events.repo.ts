import { and, desc, eq, sql } from "drizzle-orm";
import type {
  EventToIngest,
  IngestEventResult,
  StoredEvent,
} from "./events.types.js";
import { toStoredEvents } from "./events.mapper.js";
import { db, type Database } from "../../client.js";
import {
  eventLinksTable,
  eventsTable,
  outboxTable,
  sourceCursorsTable,
} from "../../schemas/events.schema.js";

const EVENTS_LIST_LIMIT = 100;

export type EventsRepoDependencies = {
  database: Database;
  eventsChannel: string;
};

export type CreateEventsRepoOptions = Partial<EventsRepoDependencies>;

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
    const latestEvents = this.dependencies.database
      .select()
      .from(eventsTable)
      .orderBy(desc(eventsTable.occurred_at), desc(eventsTable.id))
      .limit(EVENTS_LIST_LIMIT)
      .as("latest_events");

    const rows = await this.dependencies.database
      .select({
        event: {
          id: latestEvents.id,
          source: latestEvents.source,
          source_event_id: latestEvents.source_event_id,
          type: latestEvents.type,
          subject: latestEvents.subject,
          actor: latestEvents.actor,
          summary: latestEvents.summary,
          occurred_at: latestEvents.occurred_at,
          ingested_at: latestEvents.ingested_at,
          correlation_id: latestEvents.correlation_id,
          causation_event_id: latestEvents.causation_event_id,
          trace_id: latestEvents.trace_id,
          detail: latestEvents.detail,
          attributes: latestEvents.attributes,
        },
        link: eventLinksTable,
      })
      .from(latestEvents)
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, latestEvents.id))
      .orderBy(desc(latestEvents.occurred_at), desc(latestEvents.id));

    return toStoredEvents(rows);
  }

  async getEventById(id: string): Promise<StoredEvent | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const rows = await this.dependencies.database
      .select({ event: eventsTable, link: eventLinksTable })
      .from(eventsTable)
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(eq(eventsTable.id, numericId));

    return toStoredEvents(rows)[0] ?? null;
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
