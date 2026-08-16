import {
  bigint,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),

  source: text().notNull(),
  source_event_id: text(),
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
]);
