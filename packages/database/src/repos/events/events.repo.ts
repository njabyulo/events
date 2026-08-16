import { and, desc, eq, sql } from "drizzle-orm";
import type {
  EventToIngest,
  IngestEventResult,
  JsonObject,
  StoredEvent,
} from "./events.types.js";
import { db, type Database } from "../../client.js";
import { eventsTable } from "../../schemas/events.schema.js";

type EventRecord = typeof eventsTable.$inferSelect;

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

function toStoredEvent(event: EventRecord): StoredEvent {
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
    detail: asJsonObject(event.detail),
    attributes: asJsonObject(event.attributes),
  };
}

function resolveEventsChannel(value: string | undefined): string {
  const channel = value || "my_channel";
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

    return events.map(toStoredEvent);
  }

  async getEventById(id: string): Promise<StoredEvent | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const [event] = await this.dependencies.database
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, numericId))
      .limit(1);

    return event ? toStoredEvent(event) : null;
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

      if (inserted) {
        await transaction.execute(sql`select pg_notify(
          ${this.dependencies.eventsChannel},
          ${JSON.stringify({ eventId: String(id) })}
        )`);
      }

      return { id: String(id), inserted };
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
