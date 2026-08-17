import type { JsonObject, Priority, RulePattern } from "database/routing";
import { RoutingConflictError, RoutingValidationError } from "./routing.errors.js";
import { RoutingUtils } from "./routing.utils.js";

export class RulesUtils {
  static normalizeName(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RoutingValidationError("invalid_rule_name", "Rule name is required");
    }
    const name = value.trim();
    if (name.length > 160 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(name)) {
      throw new RoutingValidationError(
        "invalid_rule_name",
        "Rule name must be a namespaced identifier no longer than 160 characters",
      );
    }
    if (name.startsWith("system.")) {
      throw new RoutingValidationError(
        "reserved_rule_name",
        "The system.* rule namespace is reserved",
      );
    }
    return name;
  }

  static normalizePattern(value: unknown): RulePattern {
    if (!RulesUtils.isJsonObject(value)) {
      throw new RoutingValidationError("invalid_rule_pattern", "Rule pattern must be an object");
    }
    try {
      RoutingUtils.validatePattern(value);
      return value;
    } catch (error) {
      throw new RoutingValidationError(
        "invalid_rule_pattern",
        error instanceof Error ? error.message : "Rule pattern is invalid",
      );
    }
  }

  static normalizePriority(value: unknown, fallback?: Priority): Priority {
    if (value === undefined && fallback) return fallback;
    if (value === "urgent" || value === "normal" || value === "low") return value;
    throw new RoutingValidationError(
      "invalid_rule_priority",
      "Rule priority must be urgent, normal, or low",
    );
  }

  static normalizeEnabled(value: unknown, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      throw new RoutingValidationError("invalid_rule_enabled", "enabled must be boolean");
    }
    return value;
  }

  static assertEditableName(name: string): void {
    if (name.startsWith("system.")) {
      throw new RoutingConflictError("system_rule_protected", "System rules cannot be changed");
    }
  }

  static isUniqueViolation(error: unknown): boolean {
    return RulesUtils.isJsonObject(error) && error.code === "23505";
  }

  private static isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
