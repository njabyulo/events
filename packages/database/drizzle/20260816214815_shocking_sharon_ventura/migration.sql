CREATE INDEX "outbox_router_claim_idx" ON "outbox" ("status","available_at","locked_until");--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_rule_version_pair_check" CHECK (("rule_id" is null and "rule_version" is null)
      or ("rule_id" is not null and "rule_version" is not null));--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_version_check" CHECK ("version" > 0);