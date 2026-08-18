import type { ReplaysService, RulesService, TargetsService } from "core/routing";
import { RoutingValidationError } from "core/routing";

type RulesPort = Pick<RulesService,
  | "listRules"
  | "getRule"
  | "listRuleVersions"
  | "getRuleVersion"
  | "createRule"
  | "updateRule"
  | "deleteRule"
  | "attachTarget"
  | "detachTarget"
>;
type TargetsPort = Pick<TargetsService,
  | "listTargets"
  | "getTarget"
  | "createTarget"
  | "updateTarget"
  | "deleteTarget"
  | "enableTarget"
  | "disableTarget"
  | "testTarget"
>;
type ReplaysPort = Pick<ReplaysService, "listReplays" | "getReplay" | "createReplay">;

export class RulesHandlers {
  constructor(private readonly rules: RulesPort) {}

  list() { return this.rules.listRules(); }
  get(id: string) { return this.rules.getRule(id); }
  listVersions(id: string) { return this.rules.listRuleVersions(id); }
  getVersion(id: string, value: unknown) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new RoutingValidationError(
        "invalid_rule_version",
        "Rule version must be a positive integer",
      );
    }
    return this.rules.getRuleVersion(id, version);
  }
  create(command: Record<string, unknown>) {
    return this.rules.createRule({
      name: command.name,
      pattern: command.pattern,
      priority: command.priority,
      enabled: command.enabled,
    });
  }
  update(id: string, command: Record<string, unknown>) {
    return this.rules.updateRule(id, {
      name: command.name,
      pattern: command.pattern,
      priority: command.priority,
      enabled: command.enabled,
    });
  }
  delete(id: string) { return this.rules.deleteRule(id); }
  attachTarget(id: string, targetId: string) { return this.rules.attachTarget(id, targetId); }
  detachTarget(id: string, targetId: string) { return this.rules.detachTarget(id, targetId); }
}

export class TargetsHandlers {
  constructor(private readonly targets: TargetsPort) {}

  list() { return this.targets.listTargets(); }
  get(id: string) { return this.targets.getTarget(id); }
  create(command: Record<string, unknown>) {
    return this.targets.createTarget({
      name: command.name,
      kind: command.kind,
      config: command.config,
      enabled: command.enabled,
    });
  }
  update(id: string, command: Record<string, unknown>) {
    return this.targets.updateTarget(id, {
      name: command.name,
      kind: command.kind,
      config: command.config,
      enabled: command.enabled,
    });
  }
  delete(id: string) { return this.targets.deleteTarget(id); }
  enable(id: string) { return this.targets.enableTarget(id); }
  disable(id: string) { return this.targets.disableTarget(id); }
  test(id: string, command: Record<string, unknown>) {
    return this.targets.testTarget(id, command.actor, command.reason);
  }
}

export class ReplaysHandlers {
  constructor(private readonly replays: ReplaysPort) {}

  list() { return this.replays.listReplays(); }
  get(id: string) { return this.replays.getReplay(id); }
  create(command: Record<string, unknown>) {
    return this.replays.createReplay({
      requestedBy: command.requestedBy,
      reason: command.reason,
      eventFilter: command.eventFilter,
      ruleId: command.ruleId,
      ruleVersion: command.ruleVersion,
    });
  }
}
