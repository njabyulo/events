import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { eventsTable } from "./events.schema.js";
import {
  eventRoutesTable,
  queuesTable,
  targetTestsTable,
} from "./routing.schema.js";

type JsonObject = Record<string, unknown>;

export const escalationsTable = pgTable("escalations", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  event_id: bigint("event_id", { mode: "bigint" })
    .notNull()
    .references(() => eventsTable.id),
  queue_id: bigint("queue_id", { mode: "bigint" }).references(() => queuesTable.id),
  source_message_id: bigint("source_message_id", { mode: "bigint" }),
  route_id: bigint("route_id", { mode: "bigint" }).references(() => eventRoutesTable.id),
  target_test_id: bigint("target_test_id", { mode: "bigint" })
    .references(() => targetTestsTable.id),
  reason: text().notNull(),
  receive_count: integer().notNull(),
  status: text().notNull().default("pending"),
  available_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  locked_until: timestamp({ withTimezone: true }),
  lease_token: uuid(),
  attempt_count: integer().notNull().default(0),
  last_error: text(),
  sent_at: timestamp({ withTimezone: true }),
  sms_sid: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  dismissed_at: timestamp({ withTimezone: true }),
}, (table) => [
  uniqueIndex("escalations_source_message_key")
    .on(table.source_message_id)
    .where(sql`${table.source_message_id} is not null`),
  uniqueIndex("escalations_route_key")
    .on(table.route_id)
    .where(sql`${table.route_id} is not null`),
  uniqueIndex("escalations_target_test_key")
    .on(table.target_test_id)
    .where(sql`${table.target_test_id} is not null`),
  check(
    "escalations_status_check",
    sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'dismissed')`,
  ),
  check("escalations_receive_count_check", sql`${table.receive_count} > 0`),
  check("escalations_attempt_count_check", sql`${table.attempt_count} >= 0`),
  index("escalations_pending_claim_idx")
    .on(table.available_at, table.id)
    .where(sql`${table.status} = 'pending'`),
  index("escalations_expired_lease_idx")
    .on(table.locked_until, table.id)
    .where(sql`${table.status} = 'sending'`),
]);

export const escalationAttemptsTable = pgTable("escalation_attempts", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  escalation_id: bigint("escalation_id", { mode: "bigint" })
    .notNull()
    .references(() => escalationsTable.id),
  attempt_number: integer().notNull(),
  outcome: text().notNull(),
  sms_sid: text(),
  error: text(),
  detail: jsonb().$type<JsonObject>().notNull().default({}),
  occurred_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "escalation_attempts_outcome_check",
    sql`${table.outcome} in ('send_reserved', 'sent', 'retry_scheduled', 'failed', 'rate_limited')`,
  ),
  index("escalation_attempts_escalation_idx").on(
    table.escalation_id,
    table.occurred_at,
  ),
  index("escalation_attempts_outcome_idx").on(table.outcome, table.occurred_at),
]);
