import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),

  source: text().notNull(),
  source_event_id: text().notNull(),
  type: text().notNull(),

  subject: text(),
  actor: text(),
  summary: text(),

  occurred_at: timestamp({ withTimezone: true }).notNull(),
  ingested_at: timestamp({ withTimezone: true }).defaultNow().notNull(),

  correlation_id: text(),
  causation_event_id: bigint("causation_event_id", { mode: "number" }),
  trace_id: text(),

  detail: jsonb().notNull().default({}),
  attributes: jsonb().notNull().default({}),
}, (table) => [
  foreignKey({
    columns: [table.causation_event_id],
    foreignColumns: [table.id],
    name: "events_causation_event_id_fkey",
  }),
  unique("events_source_source_event_id_key").on(
    table.source,
    table.source_event_id,
  ),
  index("events_type_time_idx").on(table.type, table.occurred_at.desc()),
  index("events_source_time_idx").on(table.source, table.occurred_at.desc()),
]);

export const eventLinksTable = pgTable("event_links", {
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  kind: text().notNull(),
  value: text().notNull(),
}, (table) => [
  primaryKey({ columns: [table.event_id, table.kind, table.value] }),
  index("event_links_lookup_idx").on(table.kind, table.value),
]);

export const outboxTable = pgTable("outbox", {
  event_id: bigint("event_id", { mode: "number" })
    .primaryKey()
    .references(() => eventsTable.id),
  status: text().notNull().default("pending"),
  available_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  locked_until: timestamp({ withTimezone: true }),
  lease_token: uuid(),
  attempts: integer().notNull().default(0),
  last_error: text(),
  completed_at: timestamp({ withTimezone: true }),
}, (table) => [
  check(
    "outbox_status_check",
    sql`${table.status} in ('pending', 'processing', 'completed', 'failed')`,
  ),
  index("outbox_claim_idx")
    .on(table.available_at)
    .where(sql`${table.status} in ('pending', 'failed')`),
]);

export const sourceCursorsTable = pgTable("source_cursors", {
  source: text().notNull(),
  key: text().notNull(),
  cursor: text().notNull(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.source, table.key] }),
]);
