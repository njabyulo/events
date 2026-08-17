import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import { queueMessagesTable } from "../../schemas/routing.schema.js";
import { threadMessagesTable, threadsTable } from "../../schemas/threads.schema.js";
import {
  consumerInboxTable,
  messageAttemptsTable,
  streamMessagesTable,
  triageItemsTable,
} from "../../schemas/transport.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { StoredEvent } from "../events/events.types.js";
import type { ReceivedQueueMessage } from "../queues/queues.types.js";
import type {
  StreamMessageRecord,
  TriageActionResult,
  TriageDecisionRecord,
  TriageItemRecord,
} from "./triage.types.js";

type TriageRow = typeof triageItemsTable.$inferSelect;
type StreamRow = typeof streamMessagesTable.$inferSelect;

export type TriageRepoDependencies = {
  database: Database;
  sseChannel: string;
};

export type StoreClaimInput = {
  message: ReceivedQueueMessage;
  consumerName: string;
  consumerInstanceId: string;
  streamKey: string;
  threadKey: string;
  title: string;
  decision: TriageDecisionRecord;
};

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

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

export class TriageRepo {
  constructor(private readonly dependencies: TriageRepoDependencies) {}

  async storeClaim(input: StoreClaimInput): Promise<TriageItemRecord> {
    const messageId = Number(input.message.id);
    const queueId = Number(input.message.queueId);
    const eventId = Number(input.message.eventId);

    return this.dependencies.database.transaction(async (transaction) => {
      const [inbox] = await transaction.insert(consumerInboxTable).values({
        consumer_name: input.consumerName,
        event_id: eventId,
        first_message_id: messageId,
      }).onConflictDoNothing().returning({ eventId: consumerInboxTable.event_id });

      const [thread] = await transaction.insert(threadsTable).values({
        thread_key: input.threadKey,
        domain: input.decision.domain,
        priority: input.decision.priority,
        channel: input.decision.channel,
        title: input.title,
        brief: input.decision.brief,
        decided_by: input.decision.decidedBy,
        decision_reason: input.decision.reason,
        status: "open",
        first_event_at: new Date(input.message.event.occurredAt),
        last_event_at: new Date(input.message.event.occurredAt),
      }).onConflictDoUpdate({
        target: threadsTable.thread_key,
        set: {
          domain: input.decision.domain,
          priority: sql`case
            when ${threadsTable.status} <> 'open' then ${input.decision.priority}
            when ${threadsTable.priority} = 'urgent' or ${input.decision.priority} = 'urgent'
              then 'urgent'
            when ${threadsTable.priority} = 'normal' or ${input.decision.priority} = 'normal'
              then 'normal'
            else 'low'
          end`,
          channel: input.decision.channel,
          title: input.title,
          brief: input.decision.brief,
          decided_by: input.decision.decidedBy,
          decision_reason: input.decision.reason,
          status: "open",
          last_event_at: sql`greatest(
            ${threadsTable.last_event_at},
            ${new Date(input.message.event.occurredAt)}
          )`,
          updated_at: new Date(),
          acked_at: null,
        },
      }).returning();
      if (!thread) throw new Error("Thread upsert returned no row");

      await transaction.insert(threadMessagesTable).values({
        thread_id: thread.id,
        event_id: eventId,
      }).onConflictDoNothing();

      const [item] = await transaction.insert(triageItemsTable).values({
        stream_key: input.streamKey,
        consumer_name: input.consumerName,
        consumer_instance_id: input.consumerInstanceId,
        queue_message_id: messageId,
        queue_id: queueId,
        event_id: eventId,
        thread_id: thread.id,
        domain: input.decision.domain,
        priority: input.decision.priority,
        channel: input.decision.channel,
        brief: input.decision.brief,
        decided_by: input.decision.decidedBy,
        decision_reason: input.decision.reason,
        status: "pending",
        receipt_handle: input.message.receiptHandle,
        visible_until: new Date(input.message.visibleUntil),
      }).onConflictDoUpdate({
        target: triageItemsTable.queue_message_id,
        set: {
          consumer_instance_id: input.consumerInstanceId,
          status: "pending",
          receipt_handle: input.message.receiptHandle,
          visible_until: new Date(input.message.visibleUntil),
          thread_id: thread.id,
          domain: input.decision.domain,
          priority: input.decision.priority,
          channel: input.decision.channel,
          brief: input.decision.brief,
          decided_by: input.decision.decidedBy,
          decision_reason: input.decision.reason,
          updated_at: new Date(),
          acked_at: null,
        },
      }).returning();
      if (!item) throw new Error("Triage item upsert returned no row");

      const [streamMessage] = await transaction.insert(streamMessagesTable).values({
        stream_key: input.streamKey,
        event_name: "triage.item.available",
        event_id: eventId,
        triage_item_id: item.id,
        thread_id: thread.id,
        data: { duplicate: inbox === undefined, threadId: String(thread.id) },
      }).returning({ id: streamMessagesTable.id });
      if (!streamMessage) throw new Error("Stream message insert returned no ID");
      await this.notify(transaction, streamMessage.id);

      return toTriageItem(item, input.message.event);
    });
  }

  async listItems(streamKey: string): Promise<TriageItemRecord[]> {
    const rows = await this.dependencies.database
      .select({ item: triageItemsTable, event: eventsTable, link: eventLinksTable })
      .from(triageItemsTable)
      .innerJoin(eventsTable, eq(eventsTable.id, triageItemsTable.event_id))
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(and(
        eq(triageItemsTable.stream_key, streamKey),
        eq(triageItemsTable.status, "pending"),
      ))
      .orderBy(asc(triageItemsTable.id));

    const events = new Map(toStoredEvents(rows.map(({ event, link }) => ({
      event,
      link,
    }))).map((event) => [event.id, event]));
    const items = new Map<number, TriageRow>();
    for (const { item } of rows) items.set(item.id, item);
    return [...items.values()].map((item) => {
      const event = events.get(String(item.event_id));
      if (!event) throw new Error(`Triage item ${item.id} has no event`);
      return toTriageItem(item, event);
    });
  }

  async ackItem(
    itemId: string,
    receiptHandle: string,
    actor: string,
  ): Promise<TriageActionResult> {
    return this.performAction(itemId, receiptHandle, async (transaction, item) => {
      const [deleted] = await transaction.delete(queueMessagesTable).where(and(
        eq(queueMessagesTable.id, item.queue_message_id),
        eq(queueMessagesTable.receipt_handle, receiptHandle),
        gt(queueMessagesTable.visible_at, sql`now()`),
      )).returning();
      if (!deleted) return "stale";

      await transaction.insert(messageAttemptsTable).values({
        message_id: deleted.id,
        queue_id: deleted.queue_id,
        event_id: deleted.event_id,
        consumer_name: item.consumer_name,
        receipt_handle: receiptHandle,
        receive_count: deleted.receive_count,
        outcome: "acked",
        detail: { actor },
      });
      const [updated] = await transaction.update(triageItemsTable).set({
        status: "acked",
        receipt_handle: null,
        visible_until: null,
        updated_at: new Date(),
        acked_at: new Date(),
      }).where(eq(triageItemsTable.id, item.id)).returning();
      if (!updated) throw new Error("Triage ACK update returned no row");
      await this.appendAction(transaction, updated, "triage.item.acked", { actor });
      return "updated";
    });
  }

  async snoozeItem(
    itemId: string,
    receiptHandle: string,
    actor: string,
    delaySeconds: number,
  ): Promise<TriageActionResult> {
    return this.performAction(itemId, receiptHandle, async (transaction, item) => {
      const [message] = await transaction.update(queueMessagesTable).set({
        visible_at: sql`now() + (${delaySeconds} * interval '1 second')`,
        receipt_handle: null,
      }).where(and(
        eq(queueMessagesTable.id, item.queue_message_id),
        eq(queueMessagesTable.receipt_handle, receiptHandle),
        gt(queueMessagesTable.visible_at, sql`now()`),
      )).returning();
      if (!message) return "stale";

      await transaction.insert(messageAttemptsTable).values({
        message_id: message.id,
        queue_id: message.queue_id,
        event_id: message.event_id,
        consumer_name: item.consumer_name,
        receipt_handle: receiptHandle,
        receive_count: message.receive_count,
        outcome: "snoozed",
        visible_until: message.visible_at,
        detail: { actor, delaySeconds },
      });
      const [updated] = await transaction.update(triageItemsTable).set({
        status: "snoozed",
        receipt_handle: null,
        visible_until: message.visible_at,
        updated_at: new Date(),
      }).where(eq(triageItemsTable.id, item.id)).returning();
      if (!updated) throw new Error("Triage snooze update returned no row");
      await this.appendAction(
        transaction,
        updated,
        "triage.item.snoozed",
        { actor, delaySeconds },
      );
      return "updated";
    });
  }

  private async performAction(
    itemId: string,
    receiptHandle: string,
    operation: (
      transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
      item: TriageRow,
    ) => Promise<TriageActionResult>,
  ): Promise<TriageActionResult> {
    const parsed = numericId(itemId);
    if (!parsed) return "not_found";
    return this.dependencies.database.transaction(async (transaction) => {
      const [item] = await transaction.select().from(triageItemsTable).where(and(
        eq(triageItemsTable.id, parsed),
        eq(triageItemsTable.status, "pending"),
        eq(triageItemsTable.receipt_handle, receiptHandle),
      )).for("update").limit(1);
      if (!item) return "not_found";
      return operation(transaction, item);
    });
  }

  private async appendAction(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    item: TriageRow,
    eventName: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const [streamMessage] = await transaction.insert(streamMessagesTable).values({
      stream_key: item.stream_key,
      event_name: eventName,
      event_id: item.event_id,
      triage_item_id: item.id,
      thread_id: item.thread_id,
      data,
    }).returning({ id: streamMessagesTable.id });
    if (!streamMessage) throw new Error("Stream message insert returned no ID");
    await this.notify(transaction, streamMessage.id);
  }

  private async notify(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    streamMessageId: number,
  ): Promise<void> {
    await transaction.execute(sql`select pg_notify(
      ${this.dependencies.sseChannel},
      ${String(streamMessageId)}
    )`);
  }
}

function resolveChannel(value: string | undefined): string {
  const channel = value || "sse_ready";
  if (!/^[a-z_][a-z0-9_$]*$/i.test(channel)) {
    throw new Error("SSE_CHANNEL must be a valid PostgreSQL identifier");
  }
  return channel;
}

export const createTriageRepo = (
  options: Partial<TriageRepoDependencies> = {},
): TriageRepo => new TriageRepo({
  database: options.database ?? db,
  sseChannel: resolveChannel(options.sseChannel ?? process.env.SSE_CHANNEL),
});

export const triageRepo = createTriageRepo();
