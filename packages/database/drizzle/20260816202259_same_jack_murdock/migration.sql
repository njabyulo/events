-- Current sql file was generated after introspecting the database
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"source_event_id" text,
	"type" text NOT NULL,
	"subject" text,
	"actor" text,
	"summary" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text,
	"causation_event_id" bigint,
	"trace_id" text,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "events_source_source_event_id_key" UNIQUE("source","source_event_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_causation_event_id_fkey" FOREIGN KEY ("causation_event_id") REFERENCES "events"("id");
