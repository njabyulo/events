import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { eventsTable } from "./events.schema.js";

export const threadsTable = pgTable("threads", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  thread_key: text().notNull(),
  domain: text().notNull(),
  priority: text().notNull(),
  channel: text().notNull(),
  title: text().notNull(),
  brief: text().notNull(),
  decided_by: text().notNull(),
  decision_reason: text().notNull(),
  status: text().notNull().default("open"),
  first_event_at: timestamp({ withTimezone: true }).notNull(),
  last_event_at: timestamp({ withTimezone: true }).notNull(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  acked_at: timestamp({ withTimezone: true }),
}, (table) => [
  unique("threads_thread_key_key").on(table.thread_key),
  check(
    "threads_priority_check",
    sql`${table.priority} in ('urgent', 'normal', 'low')`,
  ),
  check(
    "threads_channel_check",
    sql`${table.channel} in ('web', 'digest')`,
  ),
  check(
    "threads_status_check",
    sql`${table.status} in ('open', 'snoozed', 'acked')`,
  ),
  index("threads_status_idx").on(table.status, table.last_event_at),
  index("threads_domain_idx").on(table.domain, table.last_event_at),
]);

export const threadMessagesTable = pgTable("thread_messages", {
  thread_id: bigint("thread_id", { mode: "number" })
    .notNull()
    .references(() => threadsTable.id),
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  added_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.thread_id, table.event_id] }),
  unique("thread_messages_event_key").on(table.event_id),
  index("thread_messages_thread_idx").on(table.thread_id, table.added_at),
]);
