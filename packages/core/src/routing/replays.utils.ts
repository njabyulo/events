import type { ReplayFilter } from "database/routing";
import { RoutingValidationError } from "./routing.errors.js";
import { DatabaseIds } from "../shared/database-ids.js";

export class ReplaysUtils {
  static normalizeFilter(value: unknown): ReplayFilter {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RoutingValidationError("invalid_replay_filter", "eventFilter must be an object");
    }
    const record = value as Record<string, unknown>;
    const allowed = new Set(["source", "type", "from", "to", "eventIds"]);
    const unknown = Object.keys(record).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new RoutingValidationError(
        "invalid_replay_filter",
        `Unsupported replay filter keys: ${unknown.join(", ")}`,
      );
    }

    const filter: ReplayFilter = {};
    if (record.source !== undefined) filter.source = ReplaysUtils.stringList(record.source, "source");
    if (record.type !== undefined) filter.type = ReplaysUtils.stringList(record.type, "type");
    if (record.eventIds !== undefined) {
      filter.eventIds = ReplaysUtils.stringList(record.eventIds, "eventIds").map((id) => {
        if (!DatabaseIds.isValid(id)) {
          throw new RoutingValidationError(
            "invalid_replay_filter",
            "eventIds must contain positive event IDs",
          );
        }
        return id;
      });
    }
    if (record.from !== undefined) filter.from = ReplaysUtils.timestamp(record.from, "from");
    if (record.to !== undefined) filter.to = ReplaysUtils.timestamp(record.to, "to");
    if (filter.from && filter.to && new Date(filter.from) > new Date(filter.to)) {
      throw new RoutingValidationError(
        "invalid_replay_filter",
        "eventFilter.from must not be after eventFilter.to",
      );
    }
    if (Object.keys(filter).length === 0) {
      throw new RoutingValidationError(
        "invalid_replay_filter",
        "Replay requires at least one event filter",
      );
    }
    return filter;
  }

  static positiveId(value: unknown, field: string): string {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new RoutingValidationError(
        `invalid_${field}`,
        `${field} numbers must be safe integers; use a string for larger IDs`,
      );
    }
    const normalized = DatabaseIds.normalize(value);
    if (normalized === null) {
      throw new RoutingValidationError(`invalid_${field}`, `${field} must be a positive ID`);
    }
    return normalized;
  }

  static positiveVersion(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new RoutingValidationError(
        "invalid_rule_version",
        "ruleVersion must be a positive integer",
      );
    }
    return value;
  }

  static requiredText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RoutingValidationError(`invalid_${field}`, `${field} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw new RoutingValidationError(`invalid_${field}`, `${field} is too long`);
    }
    return normalized;
  }

  private static stringList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new RoutingValidationError(
        "invalid_replay_filter",
        `eventFilter.${field} must be a non-empty string array`,
      );
    }
    const normalized = value.map((item) => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new RoutingValidationError(
          "invalid_replay_filter",
          `eventFilter.${field} must contain non-empty strings`,
        );
      }
      return item.trim();
    });
    return [...new Set(normalized)];
  }

  private static timestamp(value: unknown, field: string): string {
    if (typeof value !== "string") {
      throw new RoutingValidationError(
        "invalid_replay_filter",
        `eventFilter.${field} must be a timestamp`,
      );
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new RoutingValidationError(
        "invalid_replay_filter",
        `eventFilter.${field} must be a valid timestamp`,
      );
    }
    return parsed.toISOString();
  }
}
