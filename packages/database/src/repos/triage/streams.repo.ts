import { and, asc, eq, gt, inArray, lte, max, sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import { streamMessagesTable, triageItemsTable } from "../../schemas/transport.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { StoredEvent } from "../events/events.types.js";
import { databaseId } from "../database-id.js";
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

  async getMessageStreamKey(messageId: string): Promise<string | null> {
    const id = databaseId(messageId);
    if (id === null) return null;
    const [row] = await this.database.select({ streamKey: streamMessagesTable.stream_key })
      .from(streamMessagesTable)
      .where(eq(streamMessagesTable.id, id))
      .limit(1);
    return row?.streamKey ?? null;
  }

  async pruneMessages(defaultRetentionSeconds: number, batchSize = 100): Promise<number> {
    if (!Number.isSafeInteger(defaultRetentionSeconds) || defaultRetentionSeconds < 1) {
      throw new RangeError("defaultRetentionSeconds must be a positive integer");
    }
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new RangeError("batchSize must be between 1 and 1000");
    }
    const result = await this.database.execute(sql`
      delete from stream_messages as message
      where message.id in (
        select candidate.id
        from stream_messages as candidate
        left join event_routes as route on route.id = candidate.route_id
        where candidate.created_at + (
          case
            when route.target_config->>'replayRetentionSeconds' ~ '^[1-9][0-9]*$'
              then (route.target_config->>'replayRetentionSeconds')::int
            else ${defaultRetentionSeconds}
          end * interval '1 second'
        ) <= now()
        order by candidate.created_at, candidate.id
        for update of candidate skip locked
        limit ${batchSize}
      )
      returning message.id
    `);
    return result.rows.length;
  }

  async listMessages(
    streamKey: string,
    afterId: string,
    throughId?: string,
    limit = 250,
  ): Promise<StreamMessageRecord[]> {
    const after = databaseId(afterId) ?? 0n;
    const through = throughId === undefined ? undefined : databaseId(throughId) ?? undefined;
    const conditions = [
      eq(streamMessagesTable.stream_key, streamKey),
      gt(streamMessagesTable.id, after),
    ];
    if (through !== undefined) {
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
    const { detail: _detail, attributes: _attributes, links: _links, ...eventSummary } = event;
    const triageItem = triage ? toTriageItem(triage, event) : null;
    const compactTriageItem = triageItem
      ? (({ event: _event, ...item }) => item)(triageItem)
      : null;
    return {
      id: String(stream.id),
      streamKey: stream.stream_key,
      eventName: stream.event_name,
      eventId: String(stream.event_id),
      routeId: stream.route_id === null ? null : String(stream.route_id),
      threadId: stream.thread_id === null ? null : String(stream.thread_id),
      triageItem: compactTriageItem,
      data: stream.data,
      createdAt: stream.created_at.toISOString(),
      event: eventSummary,
    };
  }
}

export const createStreamsRepo = (database: Database = db): StreamsRepo => (
  new StreamsRepo(database)
);

export const streamsRepo = createStreamsRepo();
