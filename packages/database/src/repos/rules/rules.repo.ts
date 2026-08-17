import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import {
  rulesTable,
  ruleTargetsTable,
  ruleVersionsTable,
  targetsTable,
} from "../../schemas/routing.schema.js";
import type {
  Priority,
  RulePattern,
  RuleRecord,
  RuleVersionRecord,
} from "../routing/routing.types.js";

type RuleRow = typeof rulesTable.$inferSelect;
type RuleVersionRow = typeof ruleVersionsTable.$inferSelect;

export type CreateRuleInput = {
  name: string;
  pattern: RulePattern;
  priority: Priority;
  enabled: boolean;
};

export type UpdateRuleInput = Partial<CreateRuleInput>;

function toVersion(row: RuleVersionRow): RuleVersionRecord {
  return {
    ruleId: String(row.rule_id),
    version: row.version,
    pattern: row.pattern,
    priority: row.priority as Priority,
    createdAt: row.created_at.toISOString(),
  };
}

function toRule(
  row: RuleRow,
  version: RuleVersionRow,
  targetIds: string[] = [],
): RuleRecord {
  return {
    id: String(row.id),
    name: row.name,
    enabled: row.enabled,
    currentVersion: row.current_version,
    version: toVersion(version),
    targetIds,
    validationError: row.validation_error,
    invalidAt: row.invalid_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

type RuleWithTargetRow = {
  rule: RuleRow;
  version: RuleVersionRow;
  targetId: number | null;
};

function toRules(rows: RuleWithTargetRow[]): RuleRecord[] {
  const records = new Map<number, RuleRecord>();
  for (const { rule, version, targetId } of rows) {
    const record = records.get(rule.id) ?? toRule(rule, version);
    if (targetId !== null) record.targetIds.push(String(targetId));
    records.set(rule.id, record);
  }
  return [...records.values()];
}

export class RulesRepo {
  constructor(private readonly database: Database) {}

  async listRules(): Promise<RuleRecord[]> {
    const rows = await this.database
      .select({
        rule: rulesTable,
        version: ruleVersionsTable,
        targetId: ruleTargetsTable.target_id,
      })
      .from(rulesTable)
      .innerJoin(ruleVersionsTable, and(
        eq(ruleVersionsTable.rule_id, rulesTable.id),
        eq(ruleVersionsTable.version, rulesTable.current_version),
      ))
      .leftJoin(ruleTargetsTable, eq(ruleTargetsTable.rule_id, rulesTable.id))
      .where(isNull(rulesTable.deleted_at))
      .orderBy(asc(rulesTable.name), asc(ruleTargetsTable.target_id));

    return toRules(rows);
  }

  async getRule(id: string): Promise<RuleRecord | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const rows = await this.database
      .select({
        rule: rulesTable,
        version: ruleVersionsTable,
        targetId: ruleTargetsTable.target_id,
      })
      .from(rulesTable)
      .innerJoin(ruleVersionsTable, and(
        eq(ruleVersionsTable.rule_id, rulesTable.id),
        eq(ruleVersionsTable.version, rulesTable.current_version),
      ))
      .leftJoin(ruleTargetsTable, eq(ruleTargetsTable.rule_id, rulesTable.id))
      .where(and(eq(rulesTable.id, numericId), isNull(rulesTable.deleted_at)))
      .orderBy(asc(ruleTargetsTable.target_id));

    return toRules(rows)[0] ?? null;
  }

  async getRuleVersion(id: string, version: number): Promise<RuleVersionRecord | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    const [row] = await this.database
      .select()
      .from(ruleVersionsTable)
      .where(and(
        eq(ruleVersionsTable.rule_id, numericId),
        eq(ruleVersionsTable.version, version),
      ))
      .limit(1);

    return row ? toVersion(row) : null;
  }

  async listRuleVersions(id: string): Promise<RuleVersionRecord[]> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return [];

    const rows = await this.database
      .select()
      .from(ruleVersionsTable)
      .where(eq(ruleVersionsTable.rule_id, numericId))
      .orderBy(asc(ruleVersionsTable.version));

    return rows.map(toVersion);
  }

  async createRule(input: CreateRuleInput): Promise<RuleRecord> {
    return this.database.transaction(async (transaction) => {
      const [rule] = await transaction.insert(rulesTable).values({
        name: input.name,
        enabled: input.enabled,
      }).returning();
      if (!rule) throw new Error("Rule insert returned no row");

      const [version] = await transaction.insert(ruleVersionsTable).values({
        rule_id: rule.id,
        version: 1,
        pattern: input.pattern,
        priority: input.priority,
      }).returning();
      if (!version) throw new Error("Rule version insert returned no row");

      return toRule(rule, version, []);
    });
  }

  async updateRule(id: string, input: UpdateRuleInput): Promise<RuleRecord | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ rule: rulesTable, version: ruleVersionsTable })
        .from(rulesTable)
        .innerJoin(ruleVersionsTable, and(
          eq(ruleVersionsTable.rule_id, rulesTable.id),
          eq(ruleVersionsTable.version, rulesTable.current_version),
        ))
        .where(and(eq(rulesTable.id, numericId), isNull(rulesTable.deleted_at)))
        .for("update")
        .limit(1);
      if (!existing) return null;

      const createsVersion = input.pattern !== undefined || input.priority !== undefined;
      const nextVersion = createsVersion
        ? existing.rule.current_version + 1
        : existing.rule.current_version;

      let selectedVersion = existing.version;
      if (createsVersion) {
        const [insertedVersion] = await transaction.insert(ruleVersionsTable).values({
          rule_id: numericId,
          version: nextVersion,
          pattern: input.pattern ?? existing.version.pattern,
          priority: input.priority ?? existing.version.priority,
        }).returning();
        if (!insertedVersion) throw new Error("Rule version insert returned no row");
        selectedVersion = insertedVersion;
      }

      const [updatedRule] = await transaction.update(rulesTable).set({
        name: input.name ?? existing.rule.name,
        enabled: input.enabled ?? existing.rule.enabled,
        current_version: nextVersion,
        validation_error: createsVersion ? null : existing.rule.validation_error,
        invalid_at: createsVersion ? null : existing.rule.invalid_at,
        updated_at: new Date(),
      }).where(eq(rulesTable.id, numericId)).returning();
      if (!updatedRule) return null;

      const attachments = await transaction
        .select({ targetId: ruleTargetsTable.target_id })
        .from(ruleTargetsTable)
        .where(eq(ruleTargetsTable.rule_id, numericId));
      return toRule(
        updatedRule,
        selectedVersion,
        attachments.map(({ targetId }) => String(targetId)),
      );
    });
  }

  async deleteRule(id: string): Promise<boolean> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return false;

    const [deleted] = await this.database.update(rulesTable).set({
      enabled: false,
      deleted_at: new Date(),
      updated_at: new Date(),
    }).where(and(eq(rulesTable.id, numericId), isNull(rulesTable.deleted_at)))
      .returning({ id: rulesTable.id });
    return deleted !== undefined;
  }

  async attachTarget(ruleId: string, targetId: string): Promise<boolean> {
    const numericRuleId = Number(ruleId);
    const numericTargetId = Number(targetId);
    if (!Number.isSafeInteger(numericRuleId) || !Number.isSafeInteger(numericTargetId)) {
      return false;
    }

    return this.database.transaction(async (transaction) => {
      const [pair] = await transaction
        .select({ ruleId: rulesTable.id, targetId: targetsTable.id })
        .from(rulesTable)
        .innerJoin(targetsTable, and(
          eq(targetsTable.id, numericTargetId),
          isNull(targetsTable.deleted_at),
        ))
        .where(and(
          eq(rulesTable.id, numericRuleId),
          isNull(rulesTable.deleted_at),
        ))
        .for("share")
        .limit(1);
      if (!pair) return false;

      await transaction.insert(ruleTargetsTable).values({
        rule_id: pair.ruleId,
        target_id: pair.targetId,
      }).onConflictDoNothing();
      return true;
    });
  }

  async detachTarget(ruleId: string, targetId: string): Promise<boolean> {
    const numericRuleId = Number(ruleId);
    const numericTargetId = Number(targetId);
    if (!Number.isSafeInteger(numericRuleId) || !Number.isSafeInteger(numericTargetId)) {
      return false;
    }

    const [deleted] = await this.database.delete(ruleTargetsTable).where(and(
      eq(ruleTargetsTable.rule_id, numericRuleId),
      eq(ruleTargetsTable.target_id, numericTargetId),
    )).returning({ ruleId: ruleTargetsTable.rule_id });
    return deleted !== undefined;
  }
}

export const createRulesRepo = (database: Database = db): RulesRepo => new RulesRepo(database);
export const rulesRepo = createRulesRepo();
