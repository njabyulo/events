import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
import { eventsTable } from "./events.schema.js";
import {
  eventRoutesTable,
  queuesTable,
} from "./routing.schema.js";

type JsonObject = Record<string, unknown>;

export const messageAttemptsTable = pgTable("message_attempts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  message_id: bigint("message_id", { mode: "number" }).notNull(),
  queue_id: bigint("queue_id", { mode: "number" })
    .notNull()
    .references(() => queuesTable.id),
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  consumer_name: text(),
  receipt_handle: uuid(),
  receive_count: integer().notNull(),
  outcome: text().notNull(),
  visible_until: timestamp({ withTimezone: true }),
  detail: jsonb().$type<JsonObject>().notNull().default({}),
  occurred_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "message_attempts_outcome_check",
    sql`${table.outcome} in ('received', 'acked', 'released', 'visibility_extended', 'snoozed')`,
  ),
  index("message_attempts_message_idx").on(table.message_id, table.occurred_at),
  index("message_attempts_event_idx").on(table.event_id, table.occurred_at),
]);

export const consumerInboxTable = pgTable("consumer_inbox", {
  consumer_name: text().notNull(),
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  first_message_id: bigint("first_message_id", { mode: "number" }).notNull(),
  processed_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.consumer_name, table.event_id] }),
]);

export const triageItemsTable = pgTable("triage_items", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  stream_key: text().notNull().default("triage"),
  consumer_name: text().notNull(),
  consumer_instance_id: uuid().notNull(),
  queue_message_id: bigint("queue_message_id", { mode: "number" }).notNull(),
  queue_id: bigint("queue_id", { mode: "number" })
    .notNull()
    .references(() => queuesTable.id),
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  domain: text().notNull(),
  priority: text().notNull(),
  status: text().notNull().default("pending"),
  receipt_handle: uuid(),
  visible_until: timestamp({ withTimezone: true }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  acked_at: timestamp({ withTimezone: true }),
}, (table) => [
  unique("triage_items_queue_message_key").on(table.queue_message_id),
  check(
    "triage_items_priority_check",
    sql`${table.priority} in ('urgent', 'normal', 'low')`,
  ),
  check(
    "triage_items_status_check",
    sql`${table.status} in ('pending', 'snoozed', 'acked')`,
  ),
  index("triage_items_status_idx").on(table.stream_key, table.status, table.updated_at),
  index("triage_items_instance_idx").on(table.consumer_instance_id, table.status),
]);

export const streamMessagesTable = pgTable("stream_messages", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  stream_key: text().notNull(),
  event_name: text().notNull(),
  event_id: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => eventsTable.id),
  route_id: bigint("route_id", { mode: "number" })
    .references(() => eventRoutesTable.id),
  triage_item_id: bigint("triage_item_id", { mode: "number" })
    .references(() => triageItemsTable.id),
  data: jsonb().$type<JsonObject>().notNull().default({}),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("stream_messages_route_key").on(table.route_id),
  index("stream_messages_replay_idx").on(table.stream_key, table.id),
]);
