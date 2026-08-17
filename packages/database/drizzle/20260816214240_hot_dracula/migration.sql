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
CREATE INDEX "target_tests_pending_idx" ON "target_tests" ("created_at") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "target_tests" ADD CONSTRAINT "target_tests_target_id_targets_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id");