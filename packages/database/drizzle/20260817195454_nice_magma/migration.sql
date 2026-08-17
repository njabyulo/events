CREATE TABLE "consumer_inbox" (
	"consumer_name" text,
	"event_id" bigint,
	"first_message_id" bigint NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumer_inbox_pkey" PRIMARY KEY("consumer_name","event_id")
);
--> statement-breakpoint
CREATE TABLE "message_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "message_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"message_id" bigint NOT NULL,
	"queue_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"consumer_name" text,
	"receipt_handle" uuid,
	"receive_count" integer NOT NULL,
	"outcome" text NOT NULL,
	"visible_until" timestamp with time zone,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attempts_outcome_check" CHECK ("outcome" in ('received', 'acked', 'released', 'visibility_extended', 'snoozed'))
);
--> statement-breakpoint
CREATE TABLE "stream_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stream_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stream_key" text NOT NULL,
	"event_name" text NOT NULL,
	"event_id" bigint NOT NULL,
	"route_id" bigint CONSTRAINT "stream_messages_route_key" UNIQUE,
	"triage_item_id" bigint,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "triage_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stream_key" text DEFAULT 'triage' NOT NULL,
	"consumer_name" text NOT NULL,
	"consumer_instance_id" uuid NOT NULL,
	"queue_message_id" bigint NOT NULL CONSTRAINT "triage_items_queue_message_key" UNIQUE,
	"queue_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"domain" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"receipt_handle" uuid,
	"visible_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	CONSTRAINT "triage_items_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low')),
	CONSTRAINT "triage_items_status_check" CHECK ("status" in ('pending', 'snoozed', 'acked'))
);
--> statement-breakpoint
CREATE INDEX "message_attempts_message_idx" ON "message_attempts" ("message_id","occurred_at");--> statement-breakpoint
CREATE INDEX "message_attempts_event_idx" ON "message_attempts" ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stream_messages_replay_idx" ON "stream_messages" ("stream_key","id");--> statement-breakpoint
CREATE INDEX "triage_items_status_idx" ON "triage_items" ("stream_key","status","updated_at");--> statement-breakpoint
CREATE INDEX "triage_items_instance_idx" ON "triage_items" ("consumer_instance_id","status");--> statement-breakpoint
ALTER TABLE "consumer_inbox" ADD CONSTRAINT "consumer_inbox_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_route_id_event_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "event_routes"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_triage_item_id_triage_items_id_fkey" FOREIGN KEY ("triage_item_id") REFERENCES "triage_items"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");