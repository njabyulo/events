CREATE TABLE "dead_letter_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dead_letter_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"original_message_id" bigint NOT NULL,
	"queue_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"route_id" bigint,
	"message_group_id" text NOT NULL,
	"priority" text NOT NULL,
	"receive_count" integer NOT NULL,
	"reason" text NOT NULL,
	"last_error" text,
	"enqueued_at" timestamp with time zone NOT NULL,
	"dead_lettered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dead_letter_messages_original_key" UNIQUE("queue_id","original_message_id"),
	CONSTRAINT "dead_letter_messages_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low'))
);
--> statement-breakpoint
ALTER TABLE "escalations" DROP CONSTRAINT "escalations_source_message_key";--> statement-breakpoint
DROP INDEX "outbox_router_claim_idx";--> statement-breakpoint
DROP INDEX "escalations_claim_idx";--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "route_id" bigint;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "target_test_id" bigint;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "last_event_id" bigint;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "target_tests" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "target_tests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "target_tests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "escalations" ALTER COLUMN "queue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "escalations" ALTER COLUMN "source_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "replays" ALTER COLUMN "events_matched" SET DEFAULT 0;--> statement-breakpoint
DROP INDEX "outbox_claim_idx";--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox" ("available_at","event_id") WHERE "status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "events" ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_expired_lease_idx" ON "outbox" ("locked_until","event_id") WHERE "status" = 'processing';--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_source_message_key" ON "escalations" ("source_message_id") WHERE "source_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_route_key" ON "escalations" ("route_id") WHERE "route_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_target_test_key" ON "escalations" ("target_test_id") WHERE "target_test_id" is not null;--> statement-breakpoint
CREATE INDEX "escalations_pending_claim_idx" ON "escalations" ("available_at","id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "escalations_expired_lease_idx" ON "escalations" ("locked_until","id") WHERE "status" = 'sending';--> statement-breakpoint
CREATE INDEX "admin_actions_resource_idx" ON "admin_actions" ("resource_type","resource_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dead_letter_messages_queue_time_idx" ON "dead_letter_messages" ("queue_id","dead_lettered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dead_letter_messages_event_idx" ON "dead_letter_messages" ("event_id");--> statement-breakpoint
CREATE INDEX "queue_messages_retention_idx" ON "queue_messages" ("enqueued_at","id");--> statement-breakpoint
CREATE INDEX "replays_pending_claim_idx" ON "replays" ("available_at","id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "replays_expired_lease_idx" ON "replays" ("locked_until","id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "threads_last_event_idx" ON "threads" ("last_event_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stream_messages_created_idx" ON "stream_messages" ("created_at","id");--> statement-breakpoint
CREATE INDEX "triage_items_stream_status_id_idx" ON "triage_items" ("stream_key","status","id");--> statement-breakpoint
CREATE INDEX "triage_items_stream_thread_idx" ON "triage_items" ("stream_key","status","thread_id");--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_route_id_event_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "event_routes"("id");--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_target_test_id_target_tests_id_fkey" FOREIGN KEY ("target_test_id") REFERENCES "target_tests"("id");--> statement-breakpoint
ALTER TABLE "dead_letter_messages" ADD CONSTRAINT "dead_letter_messages_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "dead_letter_messages" ADD CONSTRAINT "dead_letter_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "dead_letter_messages" ADD CONSTRAINT "dead_letter_messages_route_id_event_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "event_routes"("id");--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_status_check", ADD CONSTRAINT "outbox_status_check" CHECK ("status" in ('pending', 'processing', 'completed', 'failed', 'dead'));--> statement-breakpoint
ALTER TABLE "message_attempts" DROP CONSTRAINT "message_attempts_outcome_check", ADD CONSTRAINT "message_attempts_outcome_check" CHECK ("outcome" in ('received', 'acked', 'nacked', 'released', 'visibility_extended', 'snoozed', 'escalated', 'dead_lettered', 'expired'));