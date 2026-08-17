INSERT INTO "queues" (
	"name", "fifo", "visibility_timeout_seconds", "max_receive_count",
	"retention_seconds", "escalate", "quiet_hours", "digest_flush_cron"
) VALUES
	('career', true, 30, 3, 1209600, false, true, null),
	('personal', true, 30, 3, 1209600, false, true, null),
	('unclassified', true, 30, 3, 1209600, false, true, null),
	('digest', true, 30, 3, 1209600, false, false, '0 7 * * *');
--> statement-breakpoint
WITH inserted_rule AS (
	INSERT INTO "rules" ("name", "enabled", "current_version")
	VALUES ('system.unclassified', true, 1)
	RETURNING "id"
)
INSERT INTO "rule_versions" ("rule_id", "version", "pattern", "priority")
SELECT "id", 1, '{"$default":true}'::jsonb, 'normal'
FROM inserted_rule;
--> statement-breakpoint
INSERT INTO "targets" ("name", "kind", "config", "enabled")
SELECT
	'system.unclassified.queue',
	'queue',
	jsonb_build_object('queueId', "id"),
	true
FROM "queues"
WHERE "name" = 'unclassified' AND "deleted_at" IS NULL;
--> statement-breakpoint
INSERT INTO "rule_targets" ("rule_id", "target_id")
SELECT "rules"."id", "targets"."id"
FROM "rules"
CROSS JOIN "targets"
WHERE "rules"."name" = 'system.unclassified'
	AND "rules"."deleted_at" IS NULL
	AND "targets"."name" = 'system.unclassified.queue'
	AND "targets"."deleted_at" IS NULL;
