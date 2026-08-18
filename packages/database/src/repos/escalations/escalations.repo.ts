import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import {
  escalationAttemptsTable,
  escalationsTable,
} from "../../schemas/escalations.schema.js";
import { eventLinksTable, eventsTable } from "../../schemas/events.schema.js";
import { adminActionsTable } from "../../schemas/routing.schema.js";
import { targetTestsTable } from "../../schemas/routing.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { StoredEvent } from "../events/events.types.js";
import { databaseId } from "../database-id.js";
import type {
  ClaimedEscalation,
  EscalationActionResult,
  EscalationAttemptRecord,
  EscalationRecord,
  SendCapacityReservation,
} from "./escalations.types.js";

type EscalationRow = typeof escalationsTable.$inferSelect;
type AttemptRow = typeof escalationAttemptsTable.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | DatabaseTransaction;

function toRecord(row: EscalationRow, event: StoredEvent): EscalationRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    queueId: row.queue_id === null ? null : String(row.queue_id),
    sourceMessageId: row.source_message_id === null ? null : String(row.source_message_id),
    routeId: row.route_id === null ? null : String(row.route_id),
    targetTestId: row.target_test_id === null ? null : String(row.target_test_id),
    reason: row.reason,
    receiveCount: row.receive_count,
    status: row.status as EscalationRecord["status"],
    availableAt: row.available_at.toISOString(),
    lockedUntil: row.locked_until?.toISOString() ?? null,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    sentAt: row.sent_at?.toISOString() ?? null,
    smsSid: row.sms_sid,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    dismissedAt: row.dismissed_at?.toISOString() ?? null,
    event,
  };
}

function toAttempt(row: AttemptRow): EscalationAttemptRecord {
  return {
    id: String(row.id),
    escalationId: String(row.escalation_id),
    attemptNumber: row.attempt_number,
    outcome: row.outcome as EscalationAttemptRecord["outcome"],
    smsSid: row.sms_sid,
    error: row.error,
    detail: row.detail,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export class EscalationsRepo {
  constructor(private readonly database: Database = db) {}

  async list(limit = 100, beforeId?: string): Promise<EscalationRecord[]> {
    const cursor = beforeId === undefined ? undefined : databaseId(beforeId);
    const rows = await this.database.select().from(escalationsTable)
      .where(cursor === undefined ? undefined : lt(escalationsTable.id, cursor ?? 0n))
      .orderBy(desc(escalationsTable.id))
      .limit(limit);
    return this.hydrate(this.database, rows);
  }

  async listAttempts(escalationId: string): Promise<EscalationAttemptRecord[]> {
    const id = databaseId(escalationId);
    if (!id) return [];
    const rows = await this.database.select().from(escalationAttemptsTable)
      .where(eq(escalationAttemptsTable.escalation_id, id))
      .orderBy(asc(escalationAttemptsTable.id));
    return rows.map(toAttempt);
  }

  async claimNext(leaseSeconds: number): Promise<ClaimedEscalation | null> {
    const leaseToken = randomUUID();
    return this.database.transaction(async (transaction) => {
      const result = await transaction.execute(sql`
        with candidate as (
          select id
          from escalations
          where available_at <= now()
            and (
              status = 'pending'
              or (status = 'sending' and locked_until <= now())
            )
          order by available_at, id
          for update skip locked
          limit 1
        )
        update escalations as escalation
        set status = 'sending',
            lease_token = ${leaseToken},
            locked_until = now() + (${leaseSeconds} * interval '1 second'),
            last_error = null,
            updated_at = now()
        from candidate
        where escalation.id = candidate.id
        returning escalation.*
      `);
      const raw = result.rows[0];
      if (!raw) return null;
      const [row] = await transaction.select().from(escalationsTable)
        .where(eq(escalationsTable.id, BigInt(String(raw.id))))
        .limit(1);
      if (!row) throw new Error("Claimed escalation disappeared");
      const [record] = await this.hydrate(transaction, [row]);
      if (!record) throw new Error("Claimed escalation event disappeared");
      return { ...record, leaseToken };
    });
  }

  async reserveSendCapacity(
    id: string,
    leaseToken: string,
    limits: { perHour: number; perDay: number; maxAttempts: number },
  ): Promise<SendCapacityReservation> {
    const parsed = databaseId(id);
    if (!parsed || !leaseToken) return { status: "lease_lost" };

    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtext('events'),
          hashtext('sms-rate-limit')
        )
      `);
      const [escalation] = await transaction.select().from(escalationsTable).where(and(
        eq(escalationsTable.id, parsed),
        eq(escalationsTable.status, "sending"),
        eq(escalationsTable.lease_token, leaseToken),
        gt(escalationsTable.locked_until, sql`now()`),
      )).for("update").limit(1);
      if (!escalation) return { status: "lease_lost" };
      if (escalation.attempt_count >= limits.maxAttempts) {
        return {
          status: "attempts_exhausted",
          attemptCount: escalation.attempt_count,
        };
      }

      const counts = await transaction.execute(sql`
        select
          count(*) filter (
            where occurred_at >= now() - interval '1 hour'
          )::int as hour_count,
          count(*) filter (
            where occurred_at >= now() - interval '1 day'
          )::int as day_count
        from escalation_attempts
        where outcome = 'send_reserved'
          and occurred_at >= now() - interval '1 day'
      `);
      const count = counts.rows[0] as {
        hour_count: number | string;
        day_count: number | string;
      } | undefined;
      if (Number(count?.day_count ?? 0) >= limits.perDay) {
        return { status: "rate_limited", delaySeconds: 3_600 };
      }
      if (Number(count?.hour_count ?? 0) >= limits.perHour) {
        return { status: "rate_limited", delaySeconds: 300 };
      }

      const [updated] = await transaction.update(escalationsTable).set({
        attempt_count: sql`${escalationsTable.attempt_count} + 1`,
        updated_at: new Date(),
      }).where(and(
        eq(escalationsTable.id, parsed),
        eq(escalationsTable.lease_token, leaseToken),
      )).returning({ attemptCount: escalationsTable.attempt_count });
      if (!updated) return { status: "lease_lost" };
      await transaction.insert(escalationAttemptsTable).values({
        escalation_id: parsed,
        attempt_number: updated.attemptCount,
        outcome: "send_reserved",
      });
      return { status: "reserved", attemptCount: updated.attemptCount };
    });
  }

  async markSent(id: string, leaseToken: string, smsSid: string): Promise<boolean> {
    return this.complete(id, leaseToken, async (transaction, row) => {
      const [updated] = await transaction.update(escalationsTable).set({
        status: "sent",
        sms_sid: smsSid,
        sent_at: new Date(),
        locked_until: null,
        lease_token: null,
        updated_at: new Date(),
      }).where(and(
        eq(escalationsTable.id, row.id),
        eq(escalationsTable.lease_token, leaseToken),
      )).returning();
      if (!updated) return false;
      if (row.target_test_id !== null) {
        await transaction.update(targetTestsTable).set({
          status: "completed",
          completed_at: new Date(),
          updated_at: new Date(),
          last_error: null,
        }).where(eq(targetTestsTable.id, row.target_test_id));
      }
      await transaction.insert(escalationAttemptsTable).values({
        escalation_id: row.id,
        attempt_number: row.attempt_count,
        outcome: "sent",
        sms_sid: smsSid,
      });
      return true;
    });
  }

  async markFailed(
    id: string,
    leaseToken: string,
    input: { retry: boolean; delaySeconds: number; error: string },
  ): Promise<boolean> {
    return this.complete(id, leaseToken, async (transaction, row) => {
      const outcome = input.retry ? "retry_scheduled" : "failed";
      const [updated] = await transaction.update(escalationsTable).set({
        status: input.retry ? "pending" : "failed",
        available_at: input.retry
          ? sql`now() + (${input.delaySeconds} * interval '1 second')`
          : row.available_at,
        locked_until: null,
        lease_token: null,
        last_error: input.error,
        updated_at: new Date(),
      }).where(and(
        eq(escalationsTable.id, row.id),
        eq(escalationsTable.lease_token, leaseToken),
      )).returning();
      if (!updated) return false;
      if (!input.retry && row.target_test_id !== null) {
        await transaction.update(targetTestsTable).set({
          status: "failed",
          completed_at: new Date(),
          updated_at: new Date(),
          last_error: input.error,
        }).where(eq(targetTestsTable.id, row.target_test_id));
      }
      await transaction.insert(escalationAttemptsTable).values({
        escalation_id: row.id,
        attempt_number: row.attempt_count,
        outcome,
        error: input.error,
        detail: { delaySeconds: input.delaySeconds },
      });
      return true;
    });
  }

  async rateLimit(
    id: string,
    leaseToken: string,
    delaySeconds: number,
  ): Promise<boolean> {
    return this.complete(id, leaseToken, async (transaction, row) => {
      const [updated] = await transaction.update(escalationsTable).set({
        status: "pending",
        available_at: sql`now() + (${delaySeconds} * interval '1 second')`,
        locked_until: null,
        lease_token: null,
        updated_at: new Date(),
      }).where(and(
        eq(escalationsTable.id, row.id),
        eq(escalationsTable.lease_token, leaseToken),
      )).returning();
      if (!updated) return false;
      await transaction.insert(escalationAttemptsTable).values({
        escalation_id: row.id,
        attempt_number: row.attempt_count,
        outcome: "rate_limited",
        detail: { delaySeconds },
      });
      return true;
    });
  }

  async dismiss(id: string, actor: string, reason: string): Promise<EscalationActionResult> {
    const parsed = databaseId(id);
    if (!parsed) return "not_found";
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(escalationsTable)
        .where(eq(escalationsTable.id, parsed)).for("update").limit(1);
      if (!current) return "not_found";
      if (current.status === "sending" && current.locked_until && current.locked_until > new Date()) {
        return "stale";
      }
      await transaction.update(escalationsTable).set({
        status: "dismissed",
        dismissed_at: new Date(),
        locked_until: null,
        lease_token: null,
        updated_at: new Date(),
      }).where(eq(escalationsTable.id, parsed));
      await this.audit(transaction, actor, "escalation.dismissed", id, reason, current.status);
      return "updated";
    });
  }

  async retry(id: string, actor: string, reason: string): Promise<EscalationActionResult> {
    const parsed = databaseId(id);
    if (!parsed) return "not_found";
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(escalationsTable)
        .where(eq(escalationsTable.id, parsed)).for("update").limit(1);
      if (!current) return "not_found";
      if (current.status !== "failed") return "stale";
      await transaction.update(escalationsTable).set({
        status: "pending",
        available_at: new Date(),
        attempt_count: 0,
        last_error: null,
        updated_at: new Date(),
      }).where(eq(escalationsTable.id, parsed));
      await this.audit(transaction, actor, "escalation.retried", id, reason, current.status);
      return "updated";
    });
  }

  private async complete(
    id: string,
    leaseToken: string,
    operation: (transaction: DatabaseTransaction, row: EscalationRow) => Promise<boolean>,
  ): Promise<boolean> {
    const parsed = databaseId(id);
    if (!parsed || !leaseToken) return false;
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction.select().from(escalationsTable).where(and(
        eq(escalationsTable.id, parsed),
        eq(escalationsTable.status, "sending"),
        eq(escalationsTable.lease_token, leaseToken),
        gt(escalationsTable.locked_until, sql`now()`),
      )).for("update").limit(1);
      return row ? operation(transaction, row) : false;
    });
  }

  private async hydrate(
    executor: QueryExecutor,
    rows: EscalationRow[],
  ): Promise<EscalationRecord[]> {
    if (rows.length === 0) return [];
    const eventRows = await executor.select({ event: eventsTable, link: eventLinksTable })
      .from(eventsTable)
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(inArray(eventsTable.id, rows.map(({ event_id }) => event_id)));
    const events = new Map(toStoredEvents(eventRows).map((event) => [event.id, event]));
    return rows.map((row) => {
      const event = events.get(String(row.event_id));
      if (!event) throw new Error(`Escalation ${row.id} has no event`);
      return toRecord(row, event);
    });
  }

  private async audit(
    transaction: DatabaseTransaction,
    actor: string,
    action: string,
    id: string,
    reason: string,
    beforeStatus: string,
  ): Promise<void> {
    await transaction.insert(adminActionsTable).values({
      actor,
      action,
      resource_type: "escalation",
      resource_id: id,
      reason,
      before: { status: beforeStatus },
      after: { status: action.endsWith("dismissed") ? "dismissed" : "pending" },
    });
  }
}

export const createEscalationsRepo = (database: Database = db): EscalationsRepo => (
  new EscalationsRepo(database)
);

export const escalationsRepo = createEscalationsRepo();
