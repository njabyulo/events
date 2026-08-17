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
CREATE UNIQUE INDEX "event_routing_skips_original_key" ON "event_routing_skips" ("event_id","rule_id","rule_version","target_id") WHERE "replay_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_routing_skips_replay_key" ON "event_routing_skips" ("event_id","rule_id","rule_version","target_id","replay_id") WHERE "replay_id" is not null;--> statement-breakpoint
CREATE INDEX "event_routing_skips_event_idx" ON "event_routing_skips" ("event_id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_replay_id_replays_id_fkey" FOREIGN KEY ("replay_id") REFERENCES "replays"("id");--> statement-breakpoint
ALTER TABLE "event_routing_skips" ADD CONSTRAINT "event_routing_skips_rule_version_fkey" FOREIGN KEY ("rule_id","rule_version") REFERENCES "rule_versions"("rule_id","version");