CREATE TABLE "event_links" (
	"event_id" bigint,
	"kind" text,
	"value" text,
	CONSTRAINT "event_links_pkey" PRIMARY KEY("event_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"event_id" bigint PRIMARY KEY,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lease_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbox_status_check" CHECK ("status" in ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"source" text,
	"key" text,
	"cursor" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_cursors_pkey" PRIMARY KEY("source","key")
);
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "source_event_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "event_links_lookup_idx" ON "event_links" ("kind","value");--> statement-breakpoint
CREATE INDEX "events_type_time_idx" ON "events" ("type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_source_time_idx" ON "events" ("source","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox" ("available_at") WHERE "status" in ('pending', 'failed');--> statement-breakpoint
ALTER TABLE "event_links" ADD CONSTRAINT "event_links_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");