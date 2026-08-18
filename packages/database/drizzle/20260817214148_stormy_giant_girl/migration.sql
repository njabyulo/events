CREATE TABLE "event_links" (
	"event_id" bigint,
	"kind" text,
	"value" text,
	CONSTRAINT "event_links_pkey" PRIMARY KEY("event_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
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
CREATE TABLE "escalation_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "escalation_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"escalation_id" bigint NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"sms_sid" text,
	"error" text,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalation_attempts_outcome_check" CHECK ("outcome" in ('sent', 'retry_scheduled', 'failed', 'rate_limited'))
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "escalations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"queue_id" bigint NOT NULL,
	"source_message_id" bigint NOT NULL CONSTRAINT "escalations_source_message_key" UNIQUE,
	"reason" text NOT NULL,
	"receive_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lease_token" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"sms_sid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "escalations_status_check" CHECK ("status" in ('pending', 'sending', 'sent', 'failed', 'dismissed')),
	CONSTRAINT "escalations_receive_count_check" CHECK ("receive_count" > 0),
	CONSTRAINT "escalations_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_routes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_routes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"rule_id" bigint NOT NULL,
	"rule_version" integer NOT NULL,
	"target_id" bigint NOT NULL,
	"replay_id" bigint,
	"priority" text NOT NULL,
	"rule_pattern" jsonb NOT NULL,
	"target_kind" text NOT NULL,
	"target_config" jsonb NOT NULL,
	"routed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_routes_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low')),
	CONSTRAINT "event_routes_target_kind_check" CHECK ("target_kind" in ('queue', 'sse', 'sms'))
);
--> statement-breakpoint
CREATE TABLE "event_routing_skips" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_routing_skips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"rule_id" bigint NOT NULL,
	"rule_version" integer NOT NULL,
	"target_id" bigint NOT NULL,
	"replay_id" bigint,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "queue_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"queue_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"route_id" bigint,
	"message_group_id" text DEFAULT 'default' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"visible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_handle" uuid,
	"receive_count" integer DEFAULT 0 NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	CONSTRAINT "queue_messages_queue_event_route_key" UNIQUE("queue_id","event_id","route_id"),
	CONSTRAINT "queue_messages_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low'))
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "queues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"fifo" boolean DEFAULT false NOT NULL,
	"visibility_timeout_seconds" integer DEFAULT 30 NOT NULL,
	"max_receive_count" integer DEFAULT 3 NOT NULL,
	"retention_seconds" integer DEFAULT 1209600 NOT NULL,
	"escalate" boolean DEFAULT false NOT NULL,
	"quiet_hours" boolean DEFAULT true NOT NULL,
	"digest_flush_cron" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "queues_visibility_timeout_check" CHECK ("visibility_timeout_seconds" > 0),
	CONSTRAINT "queues_max_receive_count_check" CHECK ("max_receive_count" > 0),
	CONSTRAINT "queues_retention_check" CHECK ("retention_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "replays" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "replays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"event_filter" jsonb NOT NULL,
	"rule_id" bigint,
	"rule_version" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"events_matched" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "replays_status_check" CHECK ("status" in ('pending', 'running', 'completed', 'failed')),
	CONSTRAINT "replays_rule_version_pair_check" CHECK (("rule_id" is null and "rule_version" is null)
      or ("rule_id" is not null and "rule_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "rule_targets" (
	"rule_id" bigint,
	"target_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_targets_pkey" PRIMARY KEY("rule_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"rule_id" bigint,
	"version" integer,
	"pattern" jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_versions_pkey" PRIMARY KEY("rule_id","version"),
	CONSTRAINT "rule_versions_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low')),
	CONSTRAINT "rule_versions_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"validation_error" text,
	"invalid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "target_tests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "target_tests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_id" bigint NOT NULL,
	"target_kind" text NOT NULL,
	"target_config" jsonb NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_tests_kind_check" CHECK ("target_kind" in ('queue', 'sse', 'sms')),
	CONSTRAINT "target_tests_status_check" CHECK ("status" in ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "targets_kind_check" CHECK ("kind" in ('queue', 'sse', 'sms'))
);
--> statement-breakpoint
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
	CONSTRAINT "threads_channel_check" CHECK ("channel" in ('web', 'digest', 'telegram', 'sms')),
	CONSTRAINT "threads_status_check" CHECK ("status" in ('open', 'snoozed', 'acked'))
);
--> statement-breakpoint
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
	CONSTRAINT "message_attempts_outcome_check" CHECK ("outcome" in ('received', 'acked', 'nacked', 'released', 'visibility_extended', 'snoozed', 'escalated'))
);
--> statement-breakpoint
CREATE TABLE "stream_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stream_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stream_key" text NOT NULL,
	"event_name" text NOT NULL,
	"event_id" bigint NOT NULL,
	"route_id" bigint CONSTRAINT "stream_messages_route_key" UNIQUE,
	"triage_item_id" bigint,
	"thread_id" bigint,
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
	"thread_id" bigint,
	"domain" text NOT NULL,
	"priority" text NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"decided_by" text DEFAULT 'rule-stub' NOT NULL,
	"decision_reason" text DEFAULT 'legacy' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"receipt_handle" uuid,
	"visible_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	CONSTRAINT "triage_items_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low')),
	CONSTRAINT "triage_items_channel_check" CHECK ("channel" in ('web', 'digest', 'telegram', 'sms')),
	CONSTRAINT "triage_items_status_check" CHECK ("status" in ('pending', 'snoozed', 'acked'))
);
--> statement-breakpoint
CREATE INDEX "event_links_lookup_idx" ON "event_links" ("kind","value");--> statement-breakpoint
CREATE INDEX "events_type_time_idx" ON "events" ("type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_source_time_idx" ON "events" ("source","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox" ("available_at") WHERE "status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "outbox_router_claim_idx" ON "outbox" ("status","available_at","locked_until");--> statement-breakpoint
CREATE INDEX "escalation_attempts_escalation_idx" ON "escalation_attempts" ("escalation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "escalation_attempts_outcome_idx" ON "escalation_attempts" ("outcome","occurred_at");--> statement-breakpoint
CREATE INDEX "escalations_claim_idx" ON "escalations" ("status","available_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_routes_original_key" ON "event_routes" ("event_id","rule_id","rule_version","target_id") WHERE "replay_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_routes_replay_key" ON "event_routes" ("event_id","rule_id","rule_version","target_id","replay_id") WHERE "replay_id" is not null;--> statement-breakpoint
CREATE INDEX "event_routes_event_idx" ON "event_routes" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_routing_skips_original_key" ON "event_routing_skips" ("event_id","rule_id","rule_version","target_id") WHERE "replay_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_routing_skips_replay_key" ON "event_routing_skips" ("event_id","rule_id","rule_version","target_id","replay_id") WHERE "replay_id" is not null;--> statement-breakpoint
CREATE INDEX "event_routing_skips_event_idx" ON "event_routing_skips" ("event_id");--> statement-breakpoint
CREATE INDEX "queue_messages_claim_idx" ON "queue_messages" ("queue_id","visible_at","id");--> statement-breakpoint
CREATE INDEX "queue_messages_group_idx" ON "queue_messages" ("queue_id","message_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "queues_active_name_key" ON "queues" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rules_active_name_key" ON "rules" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "target_tests_pending_idx" ON "target_tests" ("created_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "targets_active_name_key" ON "targets" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "targets_active_sse_stream_key" ON "targets" (("config"->>'streamKey')) WHERE "kind" = 'sse' and "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "thread_messages_thread_idx" ON "thread_messages" ("thread_id","added_at");--> statement-breakpoint
CREATE INDEX "threads_status_idx" ON "threads" ("status","last_event_at");--> statement-breakpoint
CREATE INDEX "threads_domain_idx" ON "threads" ("domain","last_event_at");--> statement-breakpoint
CREATE INDEX "message_attempts_message_idx" ON "message_attempts" ("message_id","occurred_at");--> statement-breakpoint
CREATE INDEX "message_attempts_event_idx" ON "message_attempts" ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stream_messages_replay_idx" ON "stream_messages" ("stream_key","id");--> statement-breakpoint
CREATE INDEX "triage_items_status_idx" ON "triage_items" ("stream_key","status","updated_at");--> statement-breakpoint
CREATE INDEX "triage_items_thread_idx" ON "triage_items" ("thread_id","status");--> statement-breakpoint
CREATE INDEX "triage_items_instance_idx" ON "triage_items" ("consumer_instance_id","status");--> statement-breakpoint
ALTER TABLE "event_links" ADD CONSTRAINT "event_links_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_causation_event_id_fkey" FOREIGN KEY ("causation_event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "escalation_attempts" ADD CONSTRAINT "escalation_attempts_escalation_id_escalations_id_fkey" FOREIGN KEY ("escalation_id") REFERENCES "escalations"("id");--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_replay_id_replays_id_fkey" FOREIGN KEY ("replay_id") REFERENCES "replays"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_rule_version_fkey" FOREIGN KEY ("rule_id","rule_version") REFERENCES "rule_versions"("rule_id","version");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_replay_id_replays_id_fkey" FOREIGN KEY ("replay_id") REFERENCES "replays"("id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_rule_version_fkey" FOREIGN KEY ("rule_id","rule_version") REFERENCES "rule_versions"("rule_id","version");--> statement-breakpoint
ALTER TABLE "queue_messages" ADD CONSTRAINT "queue_messages_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "queue_messages" ADD CONSTRAINT "queue_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "queue_messages" ADD CONSTRAINT "queue_messages_route_id_event_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "event_routes"("id");--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_rule_id_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id");--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_rule_version_fkey" FOREIGN KEY ("rule_id","rule_version") REFERENCES "rule_versions"("rule_id","version");--> statement-breakpoint
ALTER TABLE "rule_targets" ADD CONSTRAINT "rule_targets_rule_id_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id");--> statement-breakpoint
ALTER TABLE "rule_targets" ADD CONSTRAINT "rule_targets_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id");--> statement-breakpoint
ALTER TABLE "target_tests" ADD CONSTRAINT "target_tests_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id");--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "consumer_inbox" ADD CONSTRAINT "consumer_inbox_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_route_id_event_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "event_routes"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_triage_item_id_triage_items_id_fkey" FOREIGN KEY ("triage_item_id") REFERENCES "triage_items"("id");--> statement-breakpoint
ALTER TABLE "stream_messages" ADD CONSTRAINT "stream_messages_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id");