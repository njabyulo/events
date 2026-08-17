import type {
  Priority,
  RulePattern,
  RuleRecord,
  RulesRepo,
  RuleVersionRecord,
} from "database/rules";
import {
  RoutingConflictError,
  RoutingNotFoundError,
  RoutingStoreUnavailableError,
} from "./routing.errors.js";
import { RulesUtils } from "./rules.utils.js";

export type CreateRuleCommand = {
  name: unknown;
  pattern: unknown;
  priority?: unknown;
  enabled?: unknown;
};

export type UpdateRuleCommand = {
  name?: unknown;
  pattern?: unknown;
  priority?: unknown;
  enabled?: unknown;
};

export type RulesRepository = Pick<
  RulesRepo,
  | "listRules"
  | "getRule"
  | "getRuleVersion"
  | "listRuleVersions"
  | "createRule"
  | "updateRule"
  | "deleteRule"
  | "attachTarget"
  | "detachTarget"
>;

export type RulesServiceDependencies = { rulesRepository: RulesRepository };

export class RulesService {
  constructor(private readonly dependencies: RulesServiceDependencies) {}

  async listRules(): Promise<RuleRecord[]> {
    return this.run(() => this.dependencies.rulesRepository.listRules());
  }

  async getRule(id: string): Promise<RuleRecord> {
    const rule = await this.run(() => this.dependencies.rulesRepository.getRule(id));
    if (!rule) throw new RoutingNotFoundError("rule_not_found", "Rule does not exist");
    return rule;
  }

  async listRuleVersions(id: string): Promise<RuleVersionRecord[]> {
    await this.getRule(id);
    return this.run(() => this.dependencies.rulesRepository.listRuleVersions(id));
  }

  async getRuleVersion(id: string, version: number): Promise<RuleVersionRecord> {
    const result = await this.run(
      () => this.dependencies.rulesRepository.getRuleVersion(id, version),
    );
    if (!result) {
      throw new RoutingNotFoundError("rule_version_not_found", "Rule version does not exist");
    }
    return result;
  }

  async createRule(command: CreateRuleCommand): Promise<RuleRecord> {
    const input = {
      name: RulesUtils.normalizeName(command.name),
      pattern: RulesUtils.normalizePattern(command.pattern),
      priority: RulesUtils.normalizePriority(command.priority, "normal"),
      enabled: RulesUtils.normalizeEnabled(command.enabled, true),
    };

    try {
      return await this.dependencies.rulesRepository.createRule(input);
    } catch (error) {
      if (RulesUtils.isUniqueViolation(error)) {
        throw new RoutingConflictError("rule_name_conflict", "An active rule uses this name");
      }
      throw new RoutingStoreUnavailableError(error);
    }
  }

  async updateRule(id: string, command: UpdateRuleCommand): Promise<RuleRecord> {
    const existing = await this.getRule(id);
    RulesUtils.assertEditableName(existing.name);

    const input: {
      name?: string;
      pattern?: RulePattern;
      priority?: Priority;
      enabled?: boolean;
    } = {};
    if (command.name !== undefined) input.name = RulesUtils.normalizeName(command.name);
    if (command.pattern !== undefined) input.pattern = RulesUtils.normalizePattern(command.pattern);
    if (command.priority !== undefined) {
      input.priority = RulesUtils.normalizePriority(command.priority);
    }
    if (command.enabled !== undefined) {
      input.enabled = RulesUtils.normalizeEnabled(command.enabled, existing.enabled);
    }

    try {
      const updated = await this.dependencies.rulesRepository.updateRule(id, input);
      if (!updated) throw new RoutingNotFoundError("rule_not_found", "Rule does not exist");
      return updated;
    } catch (error) {
      if (error instanceof RoutingNotFoundError) throw error;
      if (RulesUtils.isUniqueViolation(error)) {
        throw new RoutingConflictError("rule_name_conflict", "An active rule uses this name");
      }
      throw new RoutingStoreUnavailableError(error);
    }
  }

  async deleteRule(id: string): Promise<void> {
    const existing = await this.getRule(id);
    RulesUtils.assertEditableName(existing.name);
    const deleted = await this.run(() => this.dependencies.rulesRepository.deleteRule(id));
    if (!deleted) throw new RoutingNotFoundError("rule_not_found", "Rule does not exist");
  }

  async attachTarget(ruleId: string, targetId: string): Promise<void> {
    const rule = await this.getRule(ruleId);
    RulesUtils.assertEditableName(rule.name);
    const attached = await this.run(
      () => this.dependencies.rulesRepository.attachTarget(ruleId, targetId),
    );
    if (!attached) {
      throw new RoutingNotFoundError(
        "rule_or_target_not_found",
        "Rule or target does not exist",
      );
    }
  }

  async detachTarget(ruleId: string, targetId: string): Promise<void> {
    const rule = await this.getRule(ruleId);
    RulesUtils.assertEditableName(rule.name);
    const detached = await this.run(
      () => this.dependencies.rulesRepository.detachTarget(ruleId, targetId),
    );
    if (!detached) {
      throw new RoutingNotFoundError("rule_target_not_found", "Rule target is not attached");
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof RoutingNotFoundError
        || error instanceof RoutingConflictError
      ) throw error;
      throw new RoutingStoreUnavailableError(error);
    }
  }
}

export const createRulesService = (
  dependencies: RulesServiceDependencies,
): RulesService => new RulesService(dependencies);
