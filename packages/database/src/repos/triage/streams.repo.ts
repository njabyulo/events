import { and, asc, eq, gt, inArray, lte, max } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import { streamMessagesTable, triageItemsTable } from "../../schemas/transport.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { StoredEvent } from "../events/events.types.js";
import type { StreamMessageRecord, TriageItemRecord } from "./triage.types.js";

type StreamRow = typeof streamMessagesTable.$inferSelect;
type TriageRow = typeof triageItemsTable.$inferSelect;

function toTriageItem(row: TriageRow, event: StoredEvent): TriageItemRecord {
  return {
    id: String(row.id),
    streamKey: row.stream_key,
    consumerName: row.consumer_name,
    queueMessageId: String(row.queue_message_id),
    queueId: String(row.queue_id),
    eventId: String(row.event_id),
    threadId: row.thread_id === null ? null : String(row.thread_id),
    domain: row.domain,
    priority: row.priority as TriageItemRecord["priority"],
    channel: row.channel as TriageItemRecord["channel"],
    brief: row.brief,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    status: row.status as TriageItemRecord["status"],
    receiptHandle: row.receipt_handle,
    visibleUntil: row.visible_until?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ackedAt: row.acked_at?.toISOString() ?? null,
    event,
  };
}

export class StreamsRepo {
  constructor(private readonly database: Database) {}

  async getHighWaterMark(streamKey: string): Promise<string> {
    const [row] = await this.database.select({ id: max(streamMessagesTable.id) })
      .from(streamMessagesTable)
      .where(eq(streamMessagesTable.stream_key, streamKey));
    return String(row?.id ?? 0);
  }

  async listMessages(
    streamKey: string,
    afterId: string,
    throughId?: string,
    limit = 250,
  ): Promise<StreamMessageRecord[]> {
    const after = Number(afterId);
    const through = throughId === undefined ? undefined : Number(throughId);
    const conditions = [
      eq(streamMessagesTable.stream_key, streamKey),
      gt(streamMessagesTable.id, Number.isSafeInteger(after) ? after : 0),
    ];
    if (through !== undefined && Number.isSafeInteger(through)) {
      conditions.push(lte(streamMessagesTable.id, through));
    }

    const rows = await this.database
      .select({ stream: streamMessagesTable, triage: triageItemsTable })
      .from(streamMessagesTable)
      .leftJoin(triageItemsTable, eq(triageItemsTable.id, streamMessagesTable.triage_item_id))
      .where(and(...conditions))
      .orderBy(asc(streamMessagesTable.id))
      .limit(limit);
    if (rows.length === 0) return [];

    const eventRows = await this.database
      .select({ event: eventsTable, link: eventLinksTable })
      .from(eventsTable)
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(inArray(
        eventsTable.id,
        [...new Set(rows.map(({ stream }) => stream.event_id))],
      ));
    const events = new Map(toStoredEvents(eventRows).map((event) => [event.id, event]));

    return rows.map(({ stream, triage }) => this.toStreamMessage(stream, triage, events));
  }

  private toStreamMessage(
    stream: StreamRow,
    triage: TriageRow | null,
    events: Map<string, StoredEvent>,
  ): StreamMessageRecord {
    const event = events.get(String(stream.event_id));
    if (!event) throw new Error(`Stream message ${stream.id} has no event`);
    return {
      id: String(stream.id),
      streamKey: stream.stream_key,
      eventName: stream.event_name,
      eventId: String(stream.event_id),
      routeId: stream.route_id === null ? null : String(stream.route_id),
      threadId: stream.thread_id === null ? null : String(stream.thread_id),
      triageItem: triage ? toTriageItem(triage, event) : null,
      data: stream.data,
      createdAt: stream.created_at.toISOString(),
      event,
    };
  }
}

export const createStreamsRepo = (database: Database = db): StreamsRepo => (
  new StreamsRepo(database)
);

export const streamsRepo = createStreamsRepo();
