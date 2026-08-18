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
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { eventsTable } from "./events.schema.js";
import { queuesTable } from "./routing.schema.js";

type JsonObject = Record<string, unknown>;

export const escalationsTable = pgTable("escalations", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  queue_id: bigint("queue_id", { mode: "number" })
    .notNull()
    .references(() => queuesTable.id),
  source_message_id: bigint("source_message_id", { mode: "number" }).notNull(),
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
  unique("escalations_source_message_key").on(table.source_message_id),
  check(
    "escalations_status_check",
    sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'dismissed')`,
  ),
  check("escalations_receive_count_check", sql`${table.receive_count} > 0`),
  check("escalations_attempt_count_check", sql`${table.attempt_count} >= 0`),
  index("escalations_claim_idx").on(table.status, table.available_at, table.id),
]);

export const escalationAttemptsTable = pgTable("escalation_attempts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  escalation_id: bigint("escalation_id", { mode: "number" })
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
