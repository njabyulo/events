CREATE TABLE "thread_messages" (
	"thread_id" bigint,
	"event_id" bigint CONSTRAINT "thread_messages_event_key" UNIQUE,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_messages_pkey" PRIMARY KEY("thread_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "threads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"thread_key" text NOT NULL CONSTRAINT "threads_thread_key_key" UNIQUE,
	"domain" text NOT NULL,
	"priority" text NOT NULL,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"decided_by" text NOT NULL,
	"decision_reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_event_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	CONSTRAINT "threads_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low')),
	CONSTRAINT "threads_channel_check" CHECK ("channel" in ('web', 'digest')),
	CONSTRAINT "threads_status_check" CHECK ("status" in ('open', 'snoozed', 'acked'))
);
--> statement-breakpoint
ALTER TABLE "stream_messages" ADD COLUMN "thread_id" bigint;--> statement-breakpoint
ALTER TABLE "triage_items" ADD COLUMN "thread_id" bigint;--> statement-breakpoint
ALTER TABLE "triage_items" ADD COLUMN "channel" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_items" ADD COLUMN "brief" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_items" ADD COLUMN "decided_by" text DEFAULT 'rule-stub' NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_items" ADD COLUMN "decision_reason" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX "thread_messages_thread_idx" ON "thread_messages" ("thread_id","added_at");--> statement-breakpoint
CREATE INDEX "threads_status_idx" ON "threads" ("status","last_event_at");--> statement-breakpoint
CREATE INDEX "threads_domain_idx" ON "threads" ("domain","last_event_at");--> statement-breakpoint
CREATE INDEX "triage_items_thread_idx" ON "triage_items" ("thread_id","status");--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id");--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_channel_check" CHECK ("channel" in ('web', 'digest'));--> statement-breakpoint
ALTER TABLE "message_attempts" DROP CONSTRAINT "message_attempts_outcome_check", ADD CONSTRAINT "message_attempts_outcome_check" CHECK ("outcome" in ('received', 'acked', 'nacked', 'released', 'visibility_extended', 'snoozed'));