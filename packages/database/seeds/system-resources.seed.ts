import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, type Database } from "../src/client.js";
import {
  queuesTable,
  rulesTable,
  ruleTargetsTable,
  ruleVersionsTable,
  targetsTable,
} from "../src/schemas/routing.schema.js";
import type { JsonObject } from "../src/repos/events/events.types.js";
import type { Priority } from "../src/repos/routing/routing.types.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const queueDefinitions = [
  { name: "career", fifo: true, visibility_timeout_seconds: 30, max_receive_count: 3, retention_seconds: 1_209_600, escalate: true, quiet_hours: true, digest_flush_cron: null },
  { name: "personal", fifo: true, visibility_timeout_seconds: 30, max_receive_count: 3, retention_seconds: 1_209_600, escalate: true, quiet_hours: true, digest_flush_cron: null },
  { name: "unclassified", fifo: true, visibility_timeout_seconds: 180, max_receive_count: 3, retention_seconds: 1_209_600, escalate: false, quiet_hours: false, digest_flush_cron: null },
  { name: "digest", fifo: true, visibility_timeout_seconds: 30, max_receive_count: 3, retention_seconds: 1_209_600, escalate: false, quiet_hours: false, digest_flush_cron: "0 7 * * *" },
  { name: "telegram", fifo: true, visibility_timeout_seconds: 60, max_receive_count: 3, retention_seconds: 1_209_600, escalate: true, quiet_hours: false, digest_flush_cron: null },
] as const;

type RuleDefinition = {
  name: string;
  pattern: JsonObject;
  priority: Priority;
  queueName: string;
  targetName: string;
};

const ruleDefinitions: RuleDefinition[] = [
  {
    name: "system.unclassified",
    pattern: { $default: true },
    priority: "normal",
    queueName: "unclassified",
    targetName: "system.unclassified.queue",
  },
  ...(["career", "personal"] as const).flatMap((domain) => (
    (["urgent", "normal", "low"] as const).map((priority) => ({
      name: `system.classifier.${domain}.${priority}`,
      pattern: {
        attributes: {
          classifiedBy: [{ exists: true }],
          domain: [domain],
          priority: [priority],
        },
      },
      priority,
      queueName: domain,
      targetName: `system.classifier.${domain}.queue`,
    }))
  )),
  {
    name: "system.agent.telegram",
    pattern: { attributes: { channel: ["telegram"] } },
    priority: "urgent",
    queueName: "telegram",
    targetName: "system.agent.telegram.queue",
  },
];

export async function seedSystemResources(database: Database = db): Promise<void> {
  await database.transaction(async (transaction) => {
    const queueIds = new Map<string, bigint>();
    for (const definition of queueDefinitions) {
      await transaction.insert(queuesTable).values(definition).onConflictDoNothing();
      const [queue] = await transaction.select().from(queuesTable).where(and(
        eq(queuesTable.name, definition.name),
        isNull(queuesTable.deleted_at),
      )).limit(1);
      if (!queue) throw new Error(`Could not seed queue ${definition.name}`);
      await transaction.update(queuesTable).set({
        fifo: definition.fifo,
        visibility_timeout_seconds: definition.visibility_timeout_seconds,
        max_receive_count: definition.max_receive_count,
        retention_seconds: definition.retention_seconds,
        escalate: definition.escalate,
        quiet_hours: definition.quiet_hours,
        digest_flush_cron: definition.digest_flush_cron,
      }).where(eq(queuesTable.id, queue.id));
      queueIds.set(definition.name, queue.id);
    }

    const targetIds = new Map<string, bigint>();
    for (const definition of ruleDefinitions) {
      if (targetIds.has(definition.targetName)) continue;
      const queueId = queueIds.get(definition.queueName);
      if (!queueId) throw new Error(`Seed target references missing queue ${definition.queueName}`);
      const [existing] = await transaction.select().from(targetsTable).where(and(
        eq(targetsTable.name, definition.targetName),
        isNull(targetsTable.deleted_at),
      )).limit(1);
      const [target] = existing
        ? await transaction.update(targetsTable).set({
          kind: "queue",
          config: { queueId: String(queueId) },
          enabled: true,
          updated_at: new Date(),
        }).where(eq(targetsTable.id, existing.id)).returning()
        : await transaction.insert(targetsTable).values({
          name: definition.targetName,
          kind: "queue",
          config: { queueId: String(queueId) },
          enabled: true,
        }).returning();
      if (!target) throw new Error(`Could not seed target ${definition.targetName}`);
      targetIds.set(definition.targetName, target.id);
    }

    for (const definition of ruleDefinitions) {
      const ruleId = await ensureRule(transaction, definition);
      const targetId = targetIds.get(definition.targetName);
      if (!targetId) throw new Error(`Could not resolve target ${definition.targetName}`);
      await transaction.delete(ruleTargetsTable).where(and(
        eq(ruleTargetsTable.rule_id, ruleId),
        ne(ruleTargetsTable.target_id, targetId),
      ));
      await transaction.insert(ruleTargetsTable).values({
        rule_id: ruleId,
        target_id: targetId,
      }).onConflictDoNothing();
    }
  });
}

async function ensureRule(
  transaction: Transaction,
  definition: RuleDefinition,
): Promise<bigint> {
  let [rule] = await transaction.select().from(rulesTable).where(and(
    eq(rulesTable.name, definition.name),
    isNull(rulesTable.deleted_at),
  )).limit(1);
  if (!rule) {
    [rule] = await transaction.insert(rulesTable).values({
      name: definition.name,
      enabled: true,
      current_version: 1,
    }).returning();
    if (!rule) throw new Error(`Could not seed rule ${definition.name}`);
    await transaction.insert(ruleVersionsTable).values({
      rule_id: rule.id,
      version: 1,
      pattern: definition.pattern,
      priority: definition.priority,
    });
    return rule.id;
  }

  const [current] = await transaction.select().from(ruleVersionsTable).where(and(
    eq(ruleVersionsTable.rule_id, rule.id),
    eq(ruleVersionsTable.version, rule.current_version),
  )).limit(1);
  let version = rule.current_version;
  if (
    !current
    || current.priority !== definition.priority
    || !isDeepStrictEqual(current.pattern, definition.pattern)
  ) {
    version += 1;
    await transaction.insert(ruleVersionsTable).values({
      rule_id: rule.id,
      version,
      pattern: definition.pattern,
      priority: definition.priority,
    });
  }
  await transaction.update(rulesTable).set({
    enabled: true,
    current_version: version,
    validation_error: null,
    invalid_at: null,
    updated_at: new Date(),
  }).where(eq(rulesTable.id, rule.id));
  return rule.id;
}
