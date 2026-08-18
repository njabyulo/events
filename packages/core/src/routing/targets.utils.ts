import type {
  JsonObject,
  QueueRecord,
  TargetKind,
  TargetRecord,
} from "database/routing";
import { RoutingConflictError, RoutingValidationError } from "./routing.errors.js";
import { RoutingUtils } from "./routing.utils.js";
import { DatabaseIds } from "../shared/database-ids.js";

export type SmsTargetReadiness = {
  twilioCredentialsPresent: boolean;
  destinationPresent: boolean;
  rateLimitConfigured: boolean;
};

export class TargetsUtils {
  private static readonly SENSITIVE_KEY = /(secret|password|credential|token|api.?key|account.?sid|private.?key|gmail|twilio)/i;

  static normalizeName(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RoutingValidationError("invalid_target_name", "Target name is required");
    }
    const name = value.trim();
    if (name.length > 160 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(name)) {
      throw new RoutingValidationError(
        "invalid_target_name",
        "Target name must be a namespaced identifier no longer than 160 characters",
      );
    }
    if (name.startsWith("system.")) {
      throw new RoutingValidationError(
        "reserved_target_name",
        "The system.* target namespace is reserved",
      );
    }
    return name;
  }

  static normalizeKind(value: unknown): TargetKind {
    if (value === "queue" || value === "sse" || value === "sms") return value;
    throw new RoutingValidationError(
      "invalid_target_kind",
      "Target kind must be queue, sse, or sms",
    );
  }

  static normalizeConfig(value: unknown): JsonObject {
    if (value === undefined) return {};
    if (!TargetsUtils.isObject(value)) {
      throw new RoutingValidationError("invalid_target_config", "Target config must be an object");
    }
    TargetsUtils.assertNoCredentials(value);
    try {
      JSON.stringify(value);
    } catch {
      throw new RoutingValidationError(
        "invalid_target_config",
        "Target config must be JSON serializable",
      );
    }
    return value;
  }

  static normalizeEnabled(value: unknown, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      throw new RoutingValidationError("invalid_target_enabled", "enabled must be boolean");
    }
    return value;
  }

  static validateQueueConfig(config: JsonObject, queue: QueueRecord | null): void {
    TargetsUtils.assertOnlyKeys(config, ["queueId"]);
    const queueId = config.queueId;
    if (DatabaseIds.normalize(queueId) === null) {
      throw new RoutingValidationError(
        "invalid_queue_target",
        "Queue target config.queueId must be a positive queue ID",
      );
    }
    if (!queue || queue.deletedAt !== null) {
      throw new RoutingValidationError(
        "invalid_queue_target",
        "Queue target references an unavailable queue",
      );
    }
    if (queue.name === "digest" && !queue.digestFlushCron) {
      throw new RoutingValidationError(
        "invalid_digest_target",
        "The digest queue requires digest_flush_cron",
      );
    }
    if (queue.digestFlushCron) RoutingUtils.validateCron(queue.digestFlushCron);
  }

  static validateSseConfig(config: JsonObject): void {
    TargetsUtils.assertOnlyKeys(config, ["streamKey", "replayRetentionSeconds"]);
    if (
      typeof config.streamKey !== "string"
      || !/^[A-Za-z0-9_-]{1,64}$/.test(config.streamKey)
    ) {
      throw new RoutingValidationError(
        "invalid_sse_target",
        "SSE streamKey must be URL-safe and no longer than 64 characters",
      );
    }
    if (
      typeof config.replayRetentionSeconds !== "number"
      || !Number.isSafeInteger(config.replayRetentionSeconds)
      || config.replayRetentionSeconds <= 0
    ) {
      throw new RoutingValidationError(
        "invalid_sse_target",
        "SSE replayRetentionSeconds must be a positive integer",
      );
    }
  }

  static validateSmsConfig(
    config: JsonObject,
    enabled: boolean,
    readiness: SmsTargetReadiness,
  ): void {
    TargetsUtils.assertOnlyKeys(config, []);
    if (!enabled) return;

    const missing = [
      !readiness.twilioCredentialsPresent && "Twilio credentials",
      !readiness.destinationPresent && "destination number",
      !readiness.rateLimitConfigured && "escalation rate limit",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new RoutingValidationError(
        "sms_target_not_ready",
        `SMS target cannot be enabled; missing ${missing.join(", ")}`,
      );
    }
  }

  static assertEditableName(name: string): void {
    if (name.startsWith("system.")) {
      throw new RoutingConflictError("system_target_protected", "System targets cannot be changed");
    }
  }

  static publicTarget(target: TargetRecord): TargetRecord {
    return { ...target, config: TargetsUtils.publicConfig(target.config) };
  }

  static publicConfig(config: JsonObject): JsonObject {
    return TargetsUtils.removeSensitiveValues(config);
  }

  static isUniqueViolation(error: unknown): boolean {
    return TargetsUtils.isObject(error) && error.code === "23505";
  }

  private static assertNoCredentials(value: JsonObject, path = "config"): void {
    for (const [key, child] of Object.entries(value)) {
      if (TargetsUtils.SENSITIVE_KEY.test(key)) {
        throw new RoutingValidationError(
          "credentials_not_allowed",
          `${path}.${key} cannot contain credentials; configure secrets in the environment`,
        );
      }
      if (TargetsUtils.isObject(child)) TargetsUtils.assertNoCredentials(child, `${path}.${key}`);
      if (Array.isArray(child)) {
        for (const item of child) {
          if (TargetsUtils.isObject(item)) TargetsUtils.assertNoCredentials(item, `${path}.${key}`);
        }
      }
    }
  }

  private static removeSensitiveValues(value: JsonObject): JsonObject {
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      if (TargetsUtils.SENSITIVE_KEY.test(key)) return [];
      if (TargetsUtils.isObject(child)) {
        return [[key, TargetsUtils.removeSensitiveValues(child)]];
      }
      if (Array.isArray(child)) {
        return [[key, child.map((item) => (
          TargetsUtils.isObject(item) ? TargetsUtils.removeSensitiveValues(item) : item
        ))]];
      }
      return [[key, child]];
    }));
  }

  private static assertOnlyKeys(config: JsonObject, allowed: string[]): void {
    const unknown = Object.keys(config).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new RoutingValidationError(
        "invalid_target_config",
        `Unsupported target config keys: ${unknown.join(", ")}`,
      );
    }
  }

  private static isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
