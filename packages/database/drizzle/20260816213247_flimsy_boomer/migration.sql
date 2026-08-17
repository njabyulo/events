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
	CONSTRAINT "replays_status_check" CHECK ("status" in ('pending', 'running', 'completed', 'failed'))
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
	CONSTRAINT "rule_versions_priority_check" CHECK ("priority" in ('urgent', 'normal', 'low'))
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
CREATE UNIQUE INDEX "event_routes_original_key" ON "event_routes" ("event_id","rule_id","rule_version","target_id") WHERE "replay_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_routes_replay_key" ON "event_routes" ("event_id","rule_id","rule_version","target_id","replay_id") WHERE "replay_id" is not null;--> statement-breakpoint
CREATE INDEX "event_routes_event_idx" ON "event_routes" ("event_id");--> statement-breakpoint
CREATE INDEX "queue_messages_claim_idx" ON "queue_messages" ("queue_id","visible_at","id");--> statement-breakpoint
CREATE INDEX "queue_messages_group_idx" ON "queue_messages" ("queue_id","message_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "queues_active_name_key" ON "queues" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rules_active_name_key" ON "rules" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "targets_active_name_key" ON "targets" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_replay_id_replays_id_fkey" FOREIGN KEY ("replay_id") REFERENCES "replays"("id");--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_rule_version_fkey" FOREIGN KEY ("rule_id","rule_version") REFERENCES "rule_versions"("rule_id","version");--> statement-breakpoint
ALTER TABLE "queue_messages" ADD CONSTRAINT "queue_messages_queue_id_queues_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id");--> statement-breakpoint
ALTER TABLE "queue_messages" ADD CONSTRAINT "queue_messages_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "queue_messages" ADD CONSTRAINT "queue_messages_route_id_event_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "event_routes"("id");--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_rule_id_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id");--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_rule_version_fkey" FOREIGN KEY ("rule_id","rule_version") REFERENCES "rule_versions"("rule_id","version");--> statement-breakpoint
ALTER TABLE "rule_targets" ADD CONSTRAINT "rule_targets_rule_id_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id");--> statement-breakpoint
ALTER TABLE "rule_targets" ADD CONSTRAINT "rule_targets_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id");
