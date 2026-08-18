import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { eventsTable } from "./events.schema.js";

type JsonObject = Record<string, unknown>;

export const rulesTable = pgTable("rules", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  enabled: boolean().notNull().default(true),
  current_version: integer().notNull().default(1),
  validation_error: text(),
  invalid_at: timestamp({ withTimezone: true }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp({ withTimezone: true }),
}, (table) => [
  uniqueIndex("rules_active_name_key")
    .on(table.name)
    .where(sql`${table.deleted_at} is null`),
]);

export const ruleVersionsTable = pgTable("rule_versions", {
  rule_id: bigint("rule_id", { mode: "bigint" })
    .notNull()
    .references(() => rulesTable.id),
  version: integer().notNull(),
  pattern: jsonb().$type<JsonObject>().notNull(),
  priority: text().notNull().default("normal"),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.rule_id, table.version] }),
  check(
    "rule_versions_priority_check",
    sql`${table.priority} in ('urgent', 'normal', 'low')`,
  ),
  check("rule_versions_version_check", sql`${table.version} > 0`),
]);

export const queuesTable = pgTable("queues", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  fifo: boolean().notNull().default(false),
  visibility_timeout_seconds: integer().notNull().default(30),
  max_receive_count: integer().notNull().default(3),
  retention_seconds: integer().notNull().default(1_209_600),
  escalate: boolean().notNull().default(false),
  quiet_hours: boolean().notNull().default(true),
  digest_flush_cron: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp({ withTimezone: true }),
}, (table) => [
  uniqueIndex("queues_active_name_key")
    .on(table.name)
    .where(sql`${table.deleted_at} is null`),
  check("queues_visibility_timeout_check", sql`${table.visibility_timeout_seconds} > 0`),
  check("queues_max_receive_count_check", sql`${table.max_receive_count} > 0`),
  check("queues_retention_check", sql`${table.retention_seconds} > 0`),
]);

export const targetsTable = pgTable("targets", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  kind: text().notNull(),
  config: jsonb().$type<JsonObject>().notNull().default({}),
  enabled: boolean().notNull().default(true),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp({ withTimezone: true }),
}, (table) => [
  uniqueIndex("targets_active_name_key")
    .on(table.name)
    .where(sql`${table.deleted_at} is null`),
  uniqueIndex("targets_active_sse_stream_key")
    .on(sql`(${table.config}->>'streamKey')`)
    .where(sql`${table.kind} = 'sse' and ${table.deleted_at} is null`),
  check("targets_kind_check", sql`${table.kind} in ('queue', 'sse', 'sms')`),
]);

export const targetTestsTable = pgTable("target_tests", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  target_id: bigint("target_id", { mode: "bigint" })
    .notNull()
    .references(() => targetsTable.id),
  target_kind: text().notNull(),
  target_config: jsonb().$type<JsonObject>().notNull(),
  actor: text().notNull(),
  reason: text().notNull(),
  status: text().notNull().default("pending"),
  last_error: text(),
  completed_at: timestamp({ withTimezone: true }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "target_tests_kind_check",
    sql`${table.target_kind} in ('queue', 'sse', 'sms')`,
  ),
  check(
    "target_tests_status_check",
    sql`${table.status} in ('pending', 'completed', 'failed')`,
  ),
  index("target_tests_pending_idx")
    .on(table.created_at)
    .where(sql`${table.status} = 'pending'`),
]);

export const ruleTargetsTable = pgTable("rule_targets", {
  rule_id: bigint("rule_id", { mode: "bigint" })
    .notNull()
    .references(() => rulesTable.id),
  target_id: bigint("target_id", { mode: "bigint" })
    .notNull()
    .references(() => targetsTable.id),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.rule_id, table.target_id] }),
]);

export const replaysTable = pgTable("replays", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  requested_by: text().notNull(),
  reason: text().notNull(),
  event_filter: jsonb().$type<JsonObject>().notNull(),
  rule_id: bigint("rule_id", { mode: "bigint" }).references(() => rulesTable.id),
  rule_version: integer(),
  status: text().notNull().default("pending"),
  events_matched: integer().default(0),
  attempts: integer().notNull().default(0),
  last_event_id: bigint("last_event_id", { mode: "bigint" }),
  available_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  locked_until: timestamp({ withTimezone: true }),
  lease_token: uuid(),
  last_error: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp({ withTimezone: true }),
}, (table) => [
  check(
    "replays_status_check",
    sql`${table.status} in ('pending', 'running', 'completed', 'failed')`,
  ),
  check(
    "replays_rule_version_pair_check",
    sql`(${table.rule_id} is null and ${table.rule_version} is null)
      or (${table.rule_id} is not null and ${table.rule_version} is not null)`,
  ),
  foreignKey({
    columns: [table.rule_id, table.rule_version],
    foreignColumns: [ruleVersionsTable.rule_id, ruleVersionsTable.version],
    name: "replays_rule_version_fkey",
  }),
  index("replays_pending_claim_idx")
    .on(table.available_at, table.id)
    .where(sql`${table.status} = 'pending'`),
  index("replays_expired_lease_idx")
    .on(table.locked_until, table.id)
    .where(sql`${table.status} = 'running'`),
]);

export const eventRoutesTable = pgTable("event_routes", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  event_id: bigint("event_id", { mode: "bigint" })
    .notNull()
    .references(() => eventsTable.id),
  rule_id: bigint("rule_id", { mode: "bigint" }).notNull(),
  rule_version: integer().notNull(),
  target_id: bigint("target_id", { mode: "bigint" })
    .notNull()
    .references(() => targetsTable.id),
  replay_id: bigint("replay_id", { mode: "bigint" }).references(() => replaysTable.id),
  priority: text().notNull(),
  rule_pattern: jsonb().$type<JsonObject>().notNull(),
  target_kind: text().notNull(),
  target_config: jsonb().$type<JsonObject>().notNull(),
  routed_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.rule_id, table.rule_version],
    foreignColumns: [ruleVersionsTable.rule_id, ruleVersionsTable.version],
    name: "event_routes_rule_version_fkey",
  }),
  check(
    "event_routes_priority_check",
    sql`${table.priority} in ('urgent', 'normal', 'low')`,
  ),
  check(
    "event_routes_target_kind_check",
    sql`${table.target_kind} in ('queue', 'sse', 'sms')`,
  ),
  uniqueIndex("event_routes_original_key")
    .on(table.event_id, table.rule_id, table.rule_version, table.target_id)
    .where(sql`${table.replay_id} is null`),
  uniqueIndex("event_routes_replay_key")
    .on(
      table.event_id,
      table.rule_id,
      table.rule_version,
      table.target_id,
      table.replay_id,
    )
    .where(sql`${table.replay_id} is not null`),
  index("event_routes_event_idx").on(table.event_id),
]);

export const eventRoutingSkipsTable = pgTable("event_routing_skips", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  event_id: bigint("event_id", { mode: "bigint" })
    .notNull()
    .references(() => eventsTable.id),
  rule_id: bigint("rule_id", { mode: "bigint" }).notNull(),
  rule_version: integer().notNull(),
  target_id: bigint("target_id", { mode: "bigint" })
    .notNull()
    .references(() => targetsTable.id),
  replay_id: bigint("replay_id", { mode: "bigint" }).references(() => replaysTable.id),
  reason: text().notNull(),
  recorded_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.rule_id, table.rule_version],
    foreignColumns: [ruleVersionsTable.rule_id, ruleVersionsTable.version],
    name: "event_routing_skips_rule_version_fkey",
  }),
  uniqueIndex("event_routing_skips_original_key")
    .on(table.event_id, table.rule_id, table.rule_version, table.target_id)
    .where(sql`${table.replay_id} is null`),
  uniqueIndex("event_routing_skips_replay_key")
    .on(
      table.event_id,
      table.rule_id,
      table.rule_version,
      table.target_id,
      table.replay_id,
    )
    .where(sql`${table.replay_id} is not null`),
  index("event_routing_skips_event_idx").on(table.event_id),
]);

export const queueMessagesTable = pgTable("queue_messages", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  queue_id: bigint("queue_id", { mode: "bigint" })
    .notNull()
    .references(() => queuesTable.id),
  event_id: bigint("event_id", { mode: "bigint" })
    .notNull()
    .references(() => eventsTable.id),
  route_id: bigint("route_id", { mode: "bigint" }).references(() => eventRoutesTable.id),
  message_group_id: text().notNull().default("default"),
  priority: text().notNull().default("normal"),
  visible_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  receipt_handle: uuid(),
  receive_count: integer().notNull().default(0),
  enqueued_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  last_error: text(),
}, (table) => [
  check(
    "queue_messages_priority_check",
    sql`${table.priority} in ('urgent', 'normal', 'low')`,
  ),
  unique("queue_messages_queue_event_route_key")
    .on(table.queue_id, table.event_id, table.route_id),
  index("queue_messages_claim_idx").on(
    table.queue_id,
    table.visible_at,
    table.id,
  ),
  index("queue_messages_group_idx").on(
    table.queue_id,
    table.message_group_id,
    table.id,
  ),
  index("queue_messages_retention_idx").on(table.enqueued_at, table.id),
]);

export const deadLetterMessagesTable = pgTable("dead_letter_messages", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  original_message_id: bigint("original_message_id", { mode: "bigint" }).notNull(),
  queue_id: bigint("queue_id", { mode: "bigint" })
    .notNull()
    .references(() => queuesTable.id),
  event_id: bigint("event_id", { mode: "bigint" })
    .notNull()
    .references(() => eventsTable.id),
  route_id: bigint("route_id", { mode: "bigint" }).references(() => eventRoutesTable.id),
  message_group_id: text().notNull(),
  priority: text().notNull(),
  receive_count: integer().notNull(),
  reason: text().notNull(),
  last_error: text(),
  enqueued_at: timestamp({ withTimezone: true }).notNull(),
  dead_lettered_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("dead_letter_messages_original_key").on(
    table.queue_id,
    table.original_message_id,
  ),
  check(
    "dead_letter_messages_priority_check",
    sql`${table.priority} in ('urgent', 'normal', 'low')`,
  ),
  index("dead_letter_messages_queue_time_idx").on(
    table.queue_id,
    table.dead_lettered_at.desc(),
  ),
  index("dead_letter_messages_event_idx").on(table.event_id),
]);

export const adminActionsTable = pgTable("admin_actions", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  actor: text().notNull(),
  action: text().notNull(),
  resource_type: text().notNull(),
  resource_id: text().notNull(),
  reason: text(),
  before: jsonb().$type<JsonObject>(),
  after: jsonb().$type<JsonObject>(),
  occurred_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("admin_actions_resource_idx").on(
    table.resource_type,
    table.resource_id,
    table.occurred_at.desc(),
  ),
]);
