import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import {
  queueMessagesTable,
  queuesTable,
  targetsTable,
} from "../../schemas/routing.schema.js";
import { messageAttemptsTable } from "../../schemas/transport.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { JsonObject } from "../events/events.types.js";
import type { Priority, QueueRecord } from "../routing/routing.types.js";
import type {
  MessageAttemptRecord,
  QueueMessageRecord,
  QueueStats,
  ReceivedQueueMessage,
} from "./queues.types.js";

type QueueRow = typeof queuesTable.$inferSelect;
type QueueMessageRow = typeof queueMessagesTable.$inferSelect;
type MessageAttemptRow = typeof messageAttemptsTable.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CreateQueueInput = {
  name: string;
  fifo: boolean;
  visibilityTimeoutSeconds: number;
  maxReceiveCount: number;
  retentionSeconds: number;
  escalate: boolean;
  quietHours: boolean;
  digestFlushCron: string | null;
};

export type UpdateQueueInput = Partial<CreateQueueInput>;

export type SendMessageInput = {
  queueId: string;
  eventId: string;
  delaySeconds: number;
  messageGroupId: string;
  priority: Priority;
};

export type ReceiveMessagesInput = {
  queueId: string;
  maxMessages: number;
  visibilityTimeoutSeconds?: number;
  consumerName: string;
};

export type QueueRepoDependencies = {
  database: Database;
  queueChannel: string;
};

export type DeleteQueueResult = "deleted" | "in_use" | "not_found";

function toQueue(row: QueueRow): QueueRecord {
  return {
    id: String(row.id),
    name: row.name,
    fifo: row.fifo,
    visibilityTimeoutSeconds: row.visibility_timeout_seconds,
    maxReceiveCount: row.max_receive_count,
    retentionSeconds: row.retention_seconds,
    escalate: row.escalate,
    quietHours: row.quiet_hours,
    digestFlushCron: row.digest_flush_cron,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

function toMessage(row: QueueMessageRow): QueueMessageRecord {
  return {
    id: String(row.id),
    queueId: String(row.queue_id),
    eventId: String(row.event_id),
    routeId: row.route_id === null ? null : String(row.route_id),
    messageGroupId: row.message_group_id,
    priority: row.priority as Priority,
    visibleAt: row.visible_at.toISOString(),
    receiptHandle: row.receipt_handle,
    receiveCount: row.receive_count,
    enqueuedAt: row.enqueued_at.toISOString(),
    lastError: row.last_error,
  };
}

function claimedMessage(row: Record<string, unknown>): QueueMessageRow {
  return {
    id: Number(row.id),
    queue_id: Number(row.queue_id),
    event_id: Number(row.event_id),
    route_id: row.route_id === null ? null : Number(row.route_id),
    message_group_id: String(row.message_group_id),
    priority: String(row.priority),
    visible_at: new Date(String(row.visible_at)),
    receipt_handle: row.receipt_handle === null ? null : String(row.receipt_handle),
    receive_count: Number(row.receive_count),
    enqueued_at: new Date(String(row.enqueued_at)),
    last_error: row.last_error === null ? null : String(row.last_error),
  };
}

function toAttempt(row: MessageAttemptRow): MessageAttemptRecord {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    queueId: String(row.queue_id),
    eventId: String(row.event_id),
    consumerName: row.consumer_name,
    receiptHandle: row.receipt_handle,
    receiveCount: row.receive_count,
    outcome: row.outcome as MessageAttemptRecord["outcome"],
    visibleUntil: row.visible_until?.toISOString() ?? null,
    detail: row.detail,
    occurredAt: row.occurred_at.toISOString(),
  };
}

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export class QueuesRepo {
  constructor(private readonly dependencies: QueueRepoDependencies) {}

  async listQueues(): Promise<QueueRecord[]> {
    const rows = await this.dependencies.database.select().from(queuesTable)
      .where(isNull(queuesTable.deleted_at))
      .orderBy(asc(queuesTable.name));
    return rows.map(toQueue);
  }

  async getQueue(id: string): Promise<QueueRecord | null> {
    const parsed = numericId(id);
    if (!parsed) return null;
    const [row] = await this.dependencies.database.select().from(queuesTable)
      .where(and(eq(queuesTable.id, parsed), isNull(queuesTable.deleted_at)))
      .limit(1);
    return row ? toQueue(row) : null;
  }

  async getQueueByName(name: string): Promise<QueueRecord | null> {
    const [row] = await this.dependencies.database.select().from(queuesTable)
      .where(and(eq(queuesTable.name, name), isNull(queuesTable.deleted_at)))
      .limit(1);
    return row ? toQueue(row) : null;
  }

  async createQueue(input: CreateQueueInput): Promise<QueueRecord> {
    const [row] = await this.dependencies.database.insert(queuesTable).values({
      name: input.name,
      fifo: input.fifo,
      visibility_timeout_seconds: input.visibilityTimeoutSeconds,
      max_receive_count: input.maxReceiveCount,
      retention_seconds: input.retentionSeconds,
      escalate: input.escalate,
      quiet_hours: input.quietHours,
      digest_flush_cron: input.digestFlushCron,
    }).returning();
    if (!row) throw new Error("Queue insert returned no row");
    return toQueue(row);
  }

  async updateQueue(id: string, input: UpdateQueueInput): Promise<QueueRecord | null> {
    const parsed = numericId(id);
    if (!parsed) return null;
    const updates: Partial<typeof queuesTable.$inferInsert> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.fifo !== undefined) updates.fifo = input.fifo;
    if (input.visibilityTimeoutSeconds !== undefined) {
      updates.visibility_timeout_seconds = input.visibilityTimeoutSeconds;
    }
    if (input.maxReceiveCount !== undefined) {
      updates.max_receive_count = input.maxReceiveCount;
    }
    if (input.retentionSeconds !== undefined) updates.retention_seconds = input.retentionSeconds;
    if (input.escalate !== undefined) updates.escalate = input.escalate;
    if (input.quietHours !== undefined) updates.quiet_hours = input.quietHours;
    if (input.digestFlushCron !== undefined) updates.digest_flush_cron = input.digestFlushCron;
    if (Object.keys(updates).length === 0) return this.getQueue(id);

    const [row] = await this.dependencies.database.update(queuesTable).set(updates)
      .where(and(eq(queuesTable.id, parsed), isNull(queuesTable.deleted_at)))
      .returning();
    return row ? toQueue(row) : null;
  }

  async deleteQueue(id: string): Promise<DeleteQueueResult> {
    const parsed = numericId(id);
    if (!parsed) return "not_found";

    return this.dependencies.database.transaction(async (transaction) => {
      const [queue] = await transaction.select({ id: queuesTable.id }).from(queuesTable)
        .where(and(eq(queuesTable.id, parsed), isNull(queuesTable.deleted_at)))
        .for("update")
        .limit(1);
      if (!queue) return "not_found";

      const [message] = await transaction.select({ id: queueMessagesTable.id })
        .from(queueMessagesTable)
        .where(eq(queueMessagesTable.queue_id, parsed))
        .limit(1);
      const [target] = await transaction.select({ id: targetsTable.id })
        .from(targetsTable)
        .where(and(
          eq(targetsTable.kind, "queue"),
          sql`${targetsTable.config}->>'queueId' = ${String(parsed)}`,
          isNull(targetsTable.deleted_at),
        ))
        .limit(1);
      if (message || target) return "in_use";

      await transaction.update(queuesTable).set({ deleted_at: new Date() })
        .where(eq(queuesTable.id, parsed));
      return "deleted";
    });
  }

  async sendMessage(input: SendMessageInput): Promise<QueueMessageRecord | null> {
    const queueId = numericId(input.queueId);
    const eventId = numericId(input.eventId);
    if (!queueId || !eventId) return null;

    return this.dependencies.database.transaction(async (transaction) => {
      const [references] = await transaction
        .select({ queueId: queuesTable.id, eventId: eventsTable.id })
        .from(queuesTable)
        .innerJoin(eventsTable, eq(eventsTable.id, eventId))
        .where(and(eq(queuesTable.id, queueId), isNull(queuesTable.deleted_at)))
        .limit(1);
      if (!references) return null;

      const [message] = await transaction.insert(queueMessagesTable).values({
        queue_id: references.queueId,
        event_id: references.eventId,
        message_group_id: input.messageGroupId,
        priority: input.priority,
        visible_at: sql`now() + (${input.delaySeconds} * interval '1 second')`,
      }).returning();
      if (!message) throw new Error("Queue message insert returned no row");
      await transaction.execute(sql`select pg_notify(
        ${this.dependencies.queueChannel},
        ${String(message.id)}
      )`);
      return toMessage(message);
    });
  }

  async receiveMessages(input: ReceiveMessagesInput): Promise<ReceivedQueueMessage[] | null> {
    const queueId = numericId(input.queueId);
    if (!queueId) return [];

    return this.dependencies.database.transaction(async (transaction) => {
      const [queue] = await transaction.select().from(queuesTable).where(and(
        eq(queuesTable.id, queueId),
        isNull(queuesTable.deleted_at),
      )).limit(1);
      if (!queue) return null;
      const visibility = input.visibilityTimeoutSeconds
        ?? queue.visibility_timeout_seconds;

      const result = await transaction.execute(sql`
        with candidates as (
          select id
          from queue_messages
          where queue_id = ${queueId}
            and visible_at <= now()
          order by visible_at, id
          for update skip locked
          limit ${input.maxMessages}
        )
        update queue_messages as message
        set visible_at = now() + (${visibility} * interval '1 second'),
            receipt_handle = gen_random_uuid(),
            receive_count = receive_count + 1
        from candidates
        where message.id = candidates.id
        returning message.*
      `);
      const claimed = result.rows.map((row) => claimedMessage(row));
      if (claimed.length === 0) return [];

      await transaction.insert(messageAttemptsTable).values(claimed.map((message) => ({
        message_id: message.id,
        queue_id: message.queue_id,
        event_id: message.event_id,
        consumer_name: input.consumerName,
        receipt_handle: message.receipt_handle,
        receive_count: message.receive_count,
        outcome: "received",
        visible_until: message.visible_at,
      })));

      const eventRows = await transaction
        .select({ event: eventsTable, link: eventLinksTable })
        .from(eventsTable)
        .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
        .where(inArray(eventsTable.id, claimed.map(({ event_id }) => event_id)));
      const events = new Map(toStoredEvents(eventRows).map((event) => [event.id, event]));

      return claimed.map((message) => {
        const event = events.get(String(message.event_id));
        if (!event || !message.receipt_handle) {
          throw new Error(`Claimed message ${message.id} is incomplete`);
        }
        return {
          ...toMessage(message),
          queueName: queue.name,
          visibleUntil: message.visible_at.toISOString(),
          event,
        };
      });
    });
  }

  async ackMessage(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
  ): Promise<boolean> {
    return this.withActiveLease(
      queueId,
      messageId,
      receiptHandle,
      async (transaction, numericQueueId, numericMessageId) => {
        const [deleted] = await transaction.delete(queueMessagesTable).where(and(
          eq(queueMessagesTable.id, numericMessageId),
          eq(queueMessagesTable.queue_id, numericQueueId),
          eq(queueMessagesTable.receipt_handle, receiptHandle),
          gt(queueMessagesTable.visible_at, sql`now()`),
        )).returning();
        if (!deleted) return false;
        await this.recordAttempt(transaction, deleted, consumerName, receiptHandle, "acked");
        return true;
      },
    );
  }

  async releaseMessage(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
  ): Promise<boolean> {
    return this.reschedule(
      queueId,
      messageId,
      receiptHandle,
      consumerName,
      0,
      "released",
    );
  }

  async snoozeMessage(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
    delaySeconds: number,
  ): Promise<boolean> {
    return this.reschedule(
      queueId,
      messageId,
      receiptHandle,
      consumerName,
      delaySeconds,
      "snoozed",
    );
  }

  async extendVisibility(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
    visibilityTimeoutSeconds: number,
  ): Promise<boolean> {
    return this.withActiveLease(
      queueId,
      messageId,
      receiptHandle,
      async (transaction, numericQueueId, numericMessageId) => {
        const [updated] = await transaction.update(queueMessagesTable).set({
          visible_at: sql`now() + (${visibilityTimeoutSeconds} * interval '1 second')`,
        }).where(and(
          eq(queueMessagesTable.id, numericMessageId),
          eq(queueMessagesTable.queue_id, numericQueueId),
          eq(queueMessagesTable.receipt_handle, receiptHandle),
          gt(queueMessagesTable.visible_at, sql`now()`),
        )).returning();
        if (!updated) return false;
        await this.recordAttempt(
          transaction,
          updated,
          consumerName,
          receiptHandle,
          "visibility_extended",
        );
        return true;
      },
    );
  }

  async listAttempts(messageId: string): Promise<MessageAttemptRecord[]> {
    const parsed = numericId(messageId);
    if (!parsed) return [];
    const rows = await this.dependencies.database.select().from(messageAttemptsTable)
      .where(eq(messageAttemptsTable.message_id, parsed))
      .orderBy(asc(messageAttemptsTable.id));
    return rows.map(toAttempt);
  }

  async getStats(queueId: string): Promise<QueueStats | null> {
    const parsed = numericId(queueId);
    if (!parsed) return null;
    const result = await this.dependencies.database.execute(sql`
      select q.id as queue_id,
        count(m.id) filter (where m.visible_at <= now())::int as visible,
        count(m.id) filter (
          where m.visible_at > now() and m.receipt_handle is null
        )::int as delayed,
        count(m.id) filter (
          where m.visible_at > now() and m.receipt_handle is not null
        )::int as in_flight,
        min(m.visible_at) filter (where m.visible_at <= now()) as oldest_visible_at
      from queues q
      left join queue_messages m on m.queue_id = q.id
      where q.id = ${parsed} and q.deleted_at is null
      group by q.id
    `);
    const row = result.rows[0] as {
      queue_id: number | string;
      visible: number;
      delayed: number;
      in_flight: number;
      oldest_visible_at: Date | string | null;
    } | undefined;
    if (!row) return null;
    return {
      queueId: String(row.queue_id),
      visible: Number(row.visible),
      delayed: Number(row.delayed),
      inFlight: Number(row.in_flight),
      oldestVisibleAt: row.oldest_visible_at
        ? new Date(row.oldest_visible_at).toISOString()
        : null,
    };
  }

  private async reschedule(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    consumerName: string,
    delaySeconds: number,
    outcome: "released" | "snoozed",
  ): Promise<boolean> {
    return this.withActiveLease(
      queueId,
      messageId,
      receiptHandle,
      async (transaction, numericQueueId, numericMessageId) => {
        const [updated] = await transaction.update(queueMessagesTable).set({
          visible_at: sql`now() + (${delaySeconds} * interval '1 second')`,
          receipt_handle: null,
        }).where(and(
          eq(queueMessagesTable.id, numericMessageId),
          eq(queueMessagesTable.queue_id, numericQueueId),
          eq(queueMessagesTable.receipt_handle, receiptHandle),
          gt(queueMessagesTable.visible_at, sql`now()`),
        )).returning();
        if (!updated) return false;
        await this.recordAttempt(transaction, updated, consumerName, receiptHandle, outcome);
        return true;
      },
    );
  }

  private async recordAttempt(
    transaction: DatabaseTransaction,
    message: QueueMessageRow,
    consumerName: string,
    receiptHandle: string,
    outcome: MessageAttemptRecord["outcome"],
    detail: JsonObject = {},
  ): Promise<void> {
    await transaction.insert(messageAttemptsTable).values({
      message_id: message.id,
      queue_id: message.queue_id,
      event_id: message.event_id,
      consumer_name: consumerName,
      receipt_handle: receiptHandle,
      receive_count: message.receive_count,
      outcome,
      visible_until: outcome === "acked" ? null : message.visible_at,
      detail,
    });
  }

  private async withActiveLease<T>(
    queueId: string,
    messageId: string,
    receiptHandle: string,
    operation: (
      transaction: DatabaseTransaction,
      numericQueueId: number,
      numericMessageId: number,
    ) => Promise<T>,
  ): Promise<T | false> {
    const numericQueueId = numericId(queueId);
    const numericMessageId = numericId(messageId);
    if (!numericQueueId || !numericMessageId || !receiptHandle) return false;
    return this.dependencies.database.transaction((transaction) => operation(
      transaction,
      numericQueueId,
      numericMessageId,
    ));
  }
}

function resolveChannel(value: string | undefined): string {
  const channel = value || "queue_ready";
  if (!/^[a-z_][a-z0-9_$]*$/i.test(channel)) {
    throw new Error("QUEUE_CHANNEL must be a valid PostgreSQL identifier");
  }
  return channel;
}

export const createQueuesRepo = (
  options: Partial<QueueRepoDependencies> = {},
): QueuesRepo => new QueuesRepo({
  database: options.database ?? db,
  queueChannel: resolveChannel(options.queueChannel ?? process.env.QUEUE_CHANNEL),
});

export const queuesRepo = createQueuesRepo();
