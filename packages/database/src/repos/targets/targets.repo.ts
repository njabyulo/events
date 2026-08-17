import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import {
  adminActionsTable,
  queuesTable,
  rulesTable,
  ruleTargetsTable,
  targetTestsTable,
  targetsTable,
} from "../../schemas/routing.schema.js";
import type { JsonObject } from "../events/events.types.js";
import type {
  QueueRecord,
  TargetKind,
  TargetRecord,
} from "../routing/routing.types.js";

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
  constructor(private readonly database: Database) {}

  async listTargets(): Promise<TargetRecord[]> {
    const rows = await this.database.select().from(targetsTable)
      .where(isNull(targetsTable.deleted_at))
      .orderBy(asc(targetsTable.name));
    return rows.map(toTarget);
  }

  async getTarget(id: string): Promise<TargetRecord | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

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
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const [row] = await this.database.select().from(queuesTable)
      .where(and(eq(queuesTable.id, numericId), isNull(queuesTable.deleted_at)))
      .limit(1);
    return row ? toQueue(row) : null;
  }

  async streamKeyExists(streamKey: string, excludingId?: string): Promise<boolean> {
    const excluded = excludingId ? Number(excludingId) : undefined;
    const conditions = [
      isNull(targetsTable.deleted_at),
      eq(targetsTable.kind, "sse"),
      sql`${targetsTable.config}->>'streamKey' = ${streamKey}`,
    ];
    if (excluded && Number.isSafeInteger(excluded)) {
      conditions.push(ne(targetsTable.id, excluded));
    }

    const [row] = await this.database.select({ id: targetsTable.id })
      .from(targetsTable)
      .where(and(...conditions))
      .limit(1);
    return row !== undefined;
  }

  async createTarget(input: CreateTargetInput): Promise<TargetRecord> {
    const [created] = await this.database.insert(targetsTable).values({
      name: input.name,
      kind: input.kind,
      config: input.config,
      enabled: input.enabled,
    }).returning();
    if (!created) throw new Error("Target insert returned no row");
    return toTarget(created);
  }

  async updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const updates: Partial<typeof targetsTable.$inferInsert> = {
      updated_at: new Date(),
    };
    if (input.name !== undefined) updates.name = input.name;
    if (input.kind !== undefined) updates.kind = input.kind;
    if (input.config !== undefined) updates.config = input.config;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    const [updated] = await this.database.update(targetsTable).set(updates)
      .where(and(eq(targetsTable.id, numericId), isNull(targetsTable.deleted_at)))
      .returning();
    return updated ? toTarget(updated) : null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<TargetRecord | null> {
    return this.updateTarget(id, { enabled });
  }

  async deleteTarget(id: string): Promise<DeleteTargetResult> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return "not_found";

    return this.database.transaction(async (transaction) => {
      const [target] = await transaction.select({ id: targetsTable.id })
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
      return "deleted";
    });
  }

  async scheduleTargetTest(
    target: TargetRecord,
    actor: string,
    reason: string,
  ): Promise<string> {
    return this.database.transaction(async (transaction) => {
      const [test] = await transaction.insert(targetTestsTable).values({
        target_id: Number(target.id),
        target_kind: target.kind,
        target_config: target.config,
        actor,
        reason,
      }).returning({ id: targetTestsTable.id });
      if (!test) throw new Error("Target test insert returned no ID");

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
      return String(test.id);
    });
  }
}

export const createTargetsRepo = (database: Database = db): TargetsRepo => new TargetsRepo(database);
export const targetsRepo = createTargetsRepo();
