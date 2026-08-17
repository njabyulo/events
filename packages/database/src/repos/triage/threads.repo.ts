import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import { queueMessagesTable } from "../../schemas/routing.schema.js";
import { threadMessagesTable, threadsTable } from "../../schemas/threads.schema.js";
import {
  messageAttemptsTable,
  streamMessagesTable,
  triageItemsTable,
} from "../../schemas/transport.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { StoredEvent } from "../events/events.types.js";
import type {
  ThreadRecord,
  TriageActionResult,
} from "./triage.types.js";

type ThreadRow = typeof threadsTable.$inferSelect;
type TriageRow = typeof triageItemsTable.$inferSelect;
type QueueMessageRow = typeof queueMessagesTable.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ThreadsRepoDependencies = {
  database: Database;
  sseChannel: string;
};

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function toThread(
  row: ThreadRow,
  pendingItemCount: number,
  messages: StoredEvent[],
): ThreadRecord {
  return {
    id: String(row.id),
    threadKey: row.thread_key,
    domain: row.domain,
    priority: row.priority as ThreadRecord["priority"],
    channel: row.channel as ThreadRecord["channel"],
    title: row.title,
    brief: row.brief,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    status: row.status as ThreadRecord["status"],
    firstEventAt: row.first_event_at.toISOString(),
    lastEventAt: row.last_event_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ackedAt: row.acked_at?.toISOString() ?? null,
    pendingItemCount,
    messages,
  };
}

export class ThreadsRepo {
  constructor(private readonly dependencies: ThreadsRepoDependencies) {}

  async listThreads(streamKey: string): Promise<ThreadRecord[]> {
    const rows = await this.dependencies.database
      .select({ thread: threadsTable, itemId: triageItemsTable.id })
      .from(threadsTable)
      .innerJoin(triageItemsTable, and(
        eq(triageItemsTable.thread_id, threadsTable.id),
        eq(triageItemsTable.stream_key, streamKey),
        eq(triageItemsTable.status, "pending"),
      ))
      .orderBy(desc(threadsTable.last_event_at), desc(threadsTable.id));
    if (rows.length === 0) return [];

    const threadRows = new Map<number, ThreadRow>();
    const counts = new Map<number, number>();
    for (const { thread } of rows) {
      threadRows.set(thread.id, thread);
      counts.set(thread.id, (counts.get(thread.id) ?? 0) + 1);
    }
    const messages = await this.loadMessages([...threadRows.keys()]);
    return [...threadRows.values()].map((thread) => toThread(
      thread,
      counts.get(thread.id) ?? 0,
      messages.get(thread.id) ?? [],
    ));
  }

  async getThread(id: string): Promise<ThreadRecord | null> {
    const parsed = numericId(id);
    if (!parsed) return null;
    const [thread] = await this.dependencies.database.select().from(threadsTable)
      .where(eq(threadsTable.id, parsed))
      .limit(1);
    if (!thread) return null;
    const [count] = await this.dependencies.database.select({
      value: sql<number>`count(*)::int`,
    }).from(triageItemsTable).where(and(
      eq(triageItemsTable.thread_id, parsed),
      eq(triageItemsTable.status, "pending"),
    ));
    const messages = await this.loadMessages([parsed]);
    return toThread(thread, Number(count?.value ?? 0), messages.get(parsed) ?? []);
  }

  async ackThread(threadId: string, actor: string): Promise<TriageActionResult> {
    return this.performAction(threadId, async (transaction, thread, items, messages) => {
      const deleted = await transaction.delete(queueMessagesTable)
        .where(inArray(queueMessagesTable.id, messages.map(({ id }) => id)))
        .returning();
      if (deleted.length !== messages.length) {
        throw new Error("Thread ACK lost a locked queue message");
      }
      await transaction.insert(messageAttemptsTable).values(deleted.map((message) => ({
        message_id: message.id,
        queue_id: message.queue_id,
        event_id: message.event_id,
        consumer_name: items.find((item) => item.queue_message_id === message.id)?.consumer_name,
        receipt_handle: message.receipt_handle,
        receive_count: message.receive_count,
        outcome: "acked",
        detail: { actor, threadId: String(thread.id) },
      })));
      const now = new Date();
      await transaction.update(triageItemsTable).set({
        status: "acked",
        receipt_handle: null,
        visible_until: null,
        updated_at: now,
        acked_at: now,
      }).where(inArray(triageItemsTable.id, items.map(({ id }) => id)));
      await transaction.update(threadsTable).set({
        status: "acked",
        updated_at: now,
        acked_at: now,
      }).where(eq(threadsTable.id, thread.id));
      await this.appendAction(transaction, thread, items, "thread.acked", { actor });
      return "updated";
    });
  }

  async snoozeThread(
    threadId: string,
    actor: string,
    delaySeconds: number,
  ): Promise<TriageActionResult> {
    return this.performAction(threadId, async (transaction, thread, items, messages) => {
      const updated = await transaction.update(queueMessagesTable).set({
        visible_at: sql`now() + (${delaySeconds} * interval '1 second')`,
        receipt_handle: null,
      }).where(inArray(queueMessagesTable.id, messages.map(({ id }) => id))).returning();
      if (updated.length !== messages.length) {
        throw new Error("Thread snooze lost a locked queue message");
      }
      await transaction.insert(messageAttemptsTable).values(updated.map((message) => ({
        message_id: message.id,
        queue_id: message.queue_id,
        event_id: message.event_id,
        consumer_name: items.find((item) => item.queue_message_id === message.id)?.consumer_name,
        receipt_handle: messages.find(({ id }) => id === message.id)?.receipt_handle,
        receive_count: message.receive_count,
        outcome: "snoozed",
        visible_until: message.visible_at,
        detail: { actor, delaySeconds, threadId: String(thread.id) },
      })));
      const visibleUntil = updated[0]?.visible_at ?? new Date();
      await transaction.update(triageItemsTable).set({
        status: "snoozed",
        receipt_handle: null,
        visible_until: visibleUntil,
        updated_at: new Date(),
      }).where(inArray(triageItemsTable.id, items.map(({ id }) => id)));
      await transaction.update(threadsTable).set({
        status: "snoozed",
        updated_at: new Date(),
      }).where(eq(threadsTable.id, thread.id));
      await this.appendAction(
        transaction,
        thread,
        items,
        "thread.snoozed",
        { actor, delaySeconds },
      );
      return "updated";
    });
  }

  private async performAction(
    threadId: string,
    operation: (
      transaction: DatabaseTransaction,
      thread: ThreadRow,
      items: TriageRow[],
      messages: QueueMessageRow[],
    ) => Promise<TriageActionResult>,
  ): Promise<TriageActionResult> {
    const parsed = numericId(threadId);
    if (!parsed) return "not_found";
    return this.dependencies.database.transaction(async (transaction) => {
      const [thread] = await transaction.select().from(threadsTable)
        .where(eq(threadsTable.id, parsed))
        .for("update")
        .limit(1);
      if (!thread) return "not_found";
      const items = await transaction.select().from(triageItemsTable).where(and(
        eq(triageItemsTable.thread_id, parsed),
        eq(triageItemsTable.status, "pending"),
      )).orderBy(asc(triageItemsTable.id)).for("update");
      if (items.length === 0) return "not_found";
      const messages = await transaction.select().from(queueMessagesTable).where(and(
        inArray(queueMessagesTable.id, items.map(({ queue_message_id }) => queue_message_id)),
        gt(queueMessagesTable.visible_at, sql`now()`),
      )).for("update");
      const expectedReceipts = new Map(items.map((item) => [
        item.queue_message_id,
        item.receipt_handle,
      ]));
      const leasesAreCurrent = messages.length === items.length && messages.every(
        (message) => message.receipt_handle !== null
          && message.receipt_handle === expectedReceipts.get(message.id),
      );
      if (!leasesAreCurrent) return "stale";
      return operation(transaction, thread, items, messages);
    });
  }

  private async loadMessages(threadIds: number[]): Promise<Map<number, StoredEvent[]>> {
    const rows = await this.dependencies.database
      .select({
        threadId: threadMessagesTable.thread_id,
        event: eventsTable,
        link: eventLinksTable,
      })
      .from(threadMessagesTable)
      .innerJoin(eventsTable, eq(eventsTable.id, threadMessagesTable.event_id))
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(inArray(threadMessagesTable.thread_id, threadIds))
      .orderBy(asc(eventsTable.occurred_at), asc(eventsTable.id));
    const result = new Map<number, StoredEvent[]>();
    const eventThread = new Map<string, number>();
    for (const row of rows) eventThread.set(String(row.event.id), row.threadId);
    for (const event of toStoredEvents(rows.map(({ event, link }) => ({ event, link })))) {
      const threadId = eventThread.get(event.id);
      if (threadId === undefined) continue;
      const list = result.get(threadId) ?? [];
      list.push(event);
      result.set(threadId, list);
    }
    return result;
  }

  private async appendAction(
    transaction: DatabaseTransaction,
    thread: ThreadRow,
    items: TriageRow[],
    eventName: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const item = items.at(-1);
    if (!item) return;
    const [streamMessage] = await transaction.insert(streamMessagesTable).values({
      stream_key: item.stream_key,
      event_name: eventName,
      event_id: item.event_id,
      triage_item_id: item.id,
      thread_id: thread.id,
      data: { ...data, threadId: String(thread.id) },
    }).returning({ id: streamMessagesTable.id });
    if (!streamMessage) throw new Error("Thread stream message insert returned no ID");
    await transaction.execute(sql`select pg_notify(
      ${this.dependencies.sseChannel},
      ${String(streamMessage.id)}
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

export const createThreadsRepo = (
  options: Partial<ThreadsRepoDependencies> = {},
): ThreadsRepo => new ThreadsRepo({
  database: options.database ?? db,
  sseChannel: resolveChannel(options.sseChannel ?? process.env.SSE_CHANNEL),
});

export const threadsRepo = createThreadsRepo();
