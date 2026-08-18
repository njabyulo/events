import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { escalationsTable } from "../../schemas/escalations.schema.js";
import { eventsTable, outboxTable } from "../../schemas/events.schema.js";
import {
  adminActionsTable,
  queuesTable,
  rulesTable,
  ruleTargetsTable,
  targetTestsTable,
  targetsTable,
  queueMessagesTable,
} from "../../schemas/routing.schema.js";
import { streamMessagesTable } from "../../schemas/transport.schema.js";
import type { JsonObject } from "../events/events.types.js";
import type {
  QueueRecord,
  TargetKind,
  TargetRecord,
} from "../routing/routing.types.js";
import { recordAdminAction } from "../admin-actions.js";
import { databaseId, requiredDatabaseId } from "../database-id.js";

type TargetRow = typeof targetsTable.$inferSelect;
type QueueRow = typeof queuesTable.$inferSelect;

export type CreateTargetInput = {
  name: string;
  kind: TargetKind;
  config: JsonObject;
  enabled: boolean;
};

export type UpdateTargetInput = Partial<CreateTargetInput>;
export type DeleteTargetResult = "deleted" | "in_use" | "not_found";
export type TargetTestResult = { id: string; status: "scheduled" | "completed" };

export type TargetsRepoDependencies = {
  database: Database;
  queueChannel: string;
  sseChannel: string;
};

function toTarget(row: TargetRow): TargetRecord {
  return {
    id: String(row.id),
    name: row.name,
    kind: row.kind as TargetKind,
    config: row.config,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

function toQueue(row: QueueRow): QueueRecord {
  return {
    id: String(row.id),
    name: row.name,
    fifo: row.fifo,
    visibilityTimeoutSeconds: row.visibility_timeout_seconds,
    maxReceiveCount: row.max_receive_count,
    retentionSeconds: row.retention_seconds,
    escalate: row.escalate,
    quietHours: row.quiet_hours,
    digestFlushCron: row.digest_flush_cron,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

export class TargetsRepo {
  constructor(private readonly dependencies: TargetsRepoDependencies) {}

  private get database(): Database {
    return this.dependencies.database;
  }

  async listTargets(): Promise<TargetRecord[]> {
    const rows = await this.database.select().from(targetsTable)
      .where(isNull(targetsTable.deleted_at))
      .orderBy(asc(targetsTable.name));
    return rows.map(toTarget);
  }

  async getTarget(id: string): Promise<TargetRecord | null> {
    const numericId = databaseId(id);
    if (numericId === null) return null;

    const [row] = await this.database.select().from(targetsTable)
      .where(and(eq(targetsTable.id, numericId), isNull(targetsTable.deleted_at)))
      .limit(1);
    return row ? toTarget(row) : null;
  }

  async listQueues(): Promise<QueueRecord[]> {
    const rows = await this.database.select().from(queuesTable)
      .where(isNull(queuesTable.deleted_at))
      .orderBy(asc(queuesTable.name));
    return rows.map(toQueue);
  }

  async getQueue(id: string): Promise<QueueRecord | null> {
    const numericId = databaseId(id);
    if (numericId === null) return null;

    const [row] = await this.database.select().from(queuesTable)
      .where(and(eq(queuesTable.id, numericId), isNull(queuesTable.deleted_at)))
      .limit(1);
    return row ? toQueue(row) : null;
  }

  async streamKeyExists(streamKey: string, excludingId?: string): Promise<boolean> {
    const excluded = excludingId ? databaseId(excludingId) ?? undefined : undefined;
    const conditions = [
      isNull(targetsTable.deleted_at),
      eq(targetsTable.kind, "sse"),
      sql`${targetsTable.config}->>'streamKey' = ${streamKey}`,
    ];
    if (excluded !== undefined) {
      conditions.push(ne(targetsTable.id, excluded));
    }

    const [row] = await this.database.select({ id: targetsTable.id })
      .from(targetsTable)
      .where(and(...conditions))
      .limit(1);
    return row !== undefined;
  }

  async createTarget(input: CreateTargetInput): Promise<TargetRecord> {
    return this.database.transaction(async (transaction) => {
      const [created] = await transaction.insert(targetsTable).values({
        name: input.name,
        kind: input.kind,
        config: input.config,
        enabled: input.enabled,
      }).returning();
      if (!created) throw new Error("Target insert returned no row");
      const target = toTarget(created);
      await recordAdminAction(transaction, {
        action: "target.created",
        resourceType: "target",
        resourceId: target.id,
        after: target,
      });
      return target;
    });
  }

  async updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord | null> {
    const numericId = databaseId(id);
    if (numericId === null) return null;

    const updates: Partial<typeof targetsTable.$inferInsert> = {
      updated_at: new Date(),
    };
    if (input.name !== undefined) updates.name = input.name;
    if (input.kind !== undefined) updates.kind = input.kind;
    if (input.config !== undefined) updates.config = input.config;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(targetsTable)
        .where(and(eq(targetsTable.id, numericId), isNull(targetsTable.deleted_at)))
        .for("update")
        .limit(1);
      if (!existing) return null;
      const [updated] = await transaction.update(targetsTable).set(updates)
        .where(eq(targetsTable.id, numericId))
        .returning();
      if (!updated) return null;
      const target = toTarget(updated);
      await recordAdminAction(transaction, {
        action: "target.updated",
        resourceType: "target",
        resourceId: target.id,
        before: toTarget(existing),
        after: target,
      });
      return target;
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<TargetRecord | null> {
    return this.updateTarget(id, { enabled });
  }

  async deleteTarget(id: string): Promise<DeleteTargetResult> {
    const numericId = databaseId(id);
    if (numericId === null) return "not_found";

    return this.database.transaction(async (transaction) => {
      const [target] = await transaction.select()
        .from(targetsTable)
        .where(and(eq(targetsTable.id, numericId), isNull(targetsTable.deleted_at)))
        .for("update")
        .limit(1);
      if (!target) return "not_found";

      const [reference] = await transaction.select({ ruleId: rulesTable.id })
        .from(ruleTargetsTable)
        .innerJoin(rulesTable, eq(rulesTable.id, ruleTargetsTable.rule_id))
        .where(and(
          eq(ruleTargetsTable.target_id, numericId),
          eq(rulesTable.enabled, true),
          isNull(rulesTable.deleted_at),
        ))
        .limit(1);
      if (reference) return "in_use";

      await transaction.update(targetsTable).set({
        enabled: false,
        deleted_at: new Date(),
        updated_at: new Date(),
      }).where(eq(targetsTable.id, numericId));
      await recordAdminAction(transaction, {
        action: "target.deleted",
        resourceType: "target",
        resourceId: String(numericId),
        before: toTarget(target),
        after: { enabled: false, deleted: true },
      });
      return "deleted";
    });
  }

  async scheduleTargetTest(
    target: TargetRecord,
    actor: string,
    reason: string,
  ): Promise<TargetTestResult> {
    return this.database.transaction(async (transaction) => {
      const [test] = await transaction.insert(targetTestsTable).values({
        target_id: requiredDatabaseId(target.id, "targetId"),
        target_kind: target.kind,
        target_config: target.config,
        actor,
        reason,
      }).returning({ id: targetTestsTable.id });
      if (!test) throw new Error("Target test insert returned no ID");

      const now = new Date();
      const [event] = await transaction.insert(eventsTable).values({
        source: "system.target-test",
        source_event_id: `target-test-${test.id}`,
        type: "target.test_requested",
        subject: target.name,
        actor,
        summary: `Test delivery for ${target.name}`,
        occurred_at: now,
        detail: {
          targetId: target.id,
          targetKind: target.kind,
          reason,
        },
        attributes: { schemaVersion: 1, test: true },
      }).returning({ id: eventsTable.id });
      if (!event) throw new Error("Target test event insert returned no ID");
      await transaction.insert(outboxTable).values({
        event_id: event.id,
        status: "completed",
        completed_at: now,
      });

      let status: TargetTestResult["status"] = "completed";
      if (target.kind === "queue") {
        const queueId = requiredDatabaseId(String(target.config.queueId), "queueId");
        const [message] = await transaction.insert(queueMessagesTable).values({
          queue_id: queueId,
          event_id: event.id,
          message_group_id: "target-test",
          priority: "normal",
        }).returning({ id: queueMessagesTable.id });
        if (!message) throw new Error("Target test queue delivery returned no ID");
        await transaction.execute(sql`select pg_notify(
          ${this.dependencies.queueChannel},
          ${String(message.id)}
        )`);
      } else if (target.kind === "sse") {
        const [message] = await transaction.insert(streamMessagesTable).values({
          stream_key: String(target.config.streamKey),
          event_name: "target.test",
          event_id: event.id,
          data: { targetId: target.id, targetTestId: String(test.id) },
        }).returning({ id: streamMessagesTable.id });
        if (!message) throw new Error("Target test stream delivery returned no ID");
        await transaction.execute(sql`select pg_notify(
          ${this.dependencies.sseChannel},
          ${String(message.id)}
        )`);
      } else {
        status = "scheduled";
        await transaction.insert(escalationsTable).values({
          event_id: event.id,
          target_test_id: test.id,
          reason: `test delivery requested by ${actor}`,
          receive_count: 1,
        });
      }

      if (status === "completed") {
        await transaction.update(targetTestsTable).set({
          status: "completed",
          completed_at: now,
          updated_at: now,
        }).where(eq(targetTestsTable.id, test.id));
      }

      await transaction.insert(adminActionsTable).values({
        actor,
        action: "target.test_scheduled",
        resource_type: "target_test",
        resource_id: String(test.id),
        reason,
        after: {
          targetId: target.id,
          name: target.name,
          kind: target.kind,
          config: target.config,
        },
      });
      return { id: String(test.id), status };
    });
  }
}

function resolveChannel(value: string | undefined, name: string, fallback: string): string {
  const channel = value || fallback;
  if (!/^[a-z_][a-z0-9_$]*$/i.test(channel)) {
    throw new Error(`${name} must be a valid PostgreSQL identifier`);
  }
  return channel;
}

export const createTargetsRepo = (
  options: Partial<TargetsRepoDependencies> = {},
): TargetsRepo => new TargetsRepo({
  database: options.database ?? db,
  queueChannel: resolveChannel(
    options.queueChannel ?? process.env.QUEUE_CHANNEL,
    "QUEUE_CHANNEL",
    "queue_ready",
  ),
  sseChannel: resolveChannel(
    options.sseChannel ?? process.env.SSE_CHANNEL,
    "SSE_CHANNEL",
    "sse_ready",
  ),
});
export const targetsRepo = createTargetsRepo();
