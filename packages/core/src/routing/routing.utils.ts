import type {
  JsonObject,
  QueueRecord,
  RulePattern,
  StoredEvent,
} from "database/routing";

type JsonValue = null | boolean | number | string | JsonObject | JsonValue[];
type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type RoutingScheduleConfig = {
  timeZone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export class RoutingPatternError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "RoutingPatternError";
  }
}

export class RoutingScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingScheduleError";
  }
}

export class RoutingUtils {
  private static readonly OPERATORS = new Set(["prefix", "exists", "numeric"]);
  private static readonly NUMERIC_OPERATORS = new Set([">", ">=", "<", "<=", "=", "!="]);

  static validatePattern(pattern: RulePattern): void {
    if (!RoutingUtils.isObject(pattern) || Object.keys(pattern).length === 0) {
      throw new RoutingPatternError("pattern", "must be a non-empty JSON object");
    }

    if ("$default" in pattern) {
      if (Object.keys(pattern).length !== 1 || pattern.$default !== true) {
        throw new RoutingPatternError("pattern.$default", "must be the only key and equal true");
      }
      return;
    }

    RoutingUtils.validateObject(pattern, "pattern");
  }

  static matches(pattern: RulePattern, event: StoredEvent): boolean {
    RoutingUtils.validatePattern(pattern);
    if (pattern.$default === true) return true;

    const links = event.links.reduce<Record<string, string[]>>((grouped, link) => {
      (grouped[link.kind] ??= []).push(link.value);
      return grouped;
    }, {});

    const envelope: JsonObject = {
      id: event.id,
      source: event.source,
      sourceEventId: event.sourceEventId,
      type: event.type,
      subject: event.subject,
      actor: event.actor,
      summary: event.summary,
      occurredAt: event.occurredAt,
      ingestedAt: event.ingestedAt,
      correlationId: event.correlationId,
      causationEventId: event.causationEventId,
      traceId: event.traceId,
      detail: event.detail,
      attributes: event.attributes,
      links,
    };

    return RoutingUtils.matchObject(pattern, envelope);
  }

  static computeVisibleAt(
    priority: "urgent" | "normal" | "low",
    queue: QueueRecord,
    now: Date,
    config: RoutingScheduleConfig,
  ): Date {
    RoutingUtils.assertValidDate(now);
    RoutingUtils.assertTimeZone(config.timeZone);

    if (priority === "urgent") return new Date(now);

    if (priority === "low" && queue.digestFlushCron) {
      return RoutingUtils.nextCronOccurrence(queue.digestFlushCron, now, config.timeZone);
    }

    if (!queue.quietHours) return new Date(now);

    const start = RoutingUtils.parseClock(config.quietHoursStart, "QUIET_HOURS_START");
    const end = RoutingUtils.parseClock(config.quietHoursEnd, "QUIET_HOURS_END");
    const local = RoutingUtils.zonedParts(now, config.timeZone);
    const currentMinute = local.hour * 60 + local.minute;
    const inQuietHours = start === end
      ? true
      : start < end
        ? currentMinute >= start && currentMinute < end
        : currentMinute >= start || currentMinute < end;

    if (!inQuietHours) return new Date(now);
    return RoutingUtils.nextLocalMinute(end, now, config.timeZone);
  }

  static validateCron(cron: string): void {
    RoutingUtils.parseDailyCron(cron);
  }

  static nextCronOccurrence(cron: string, now: Date, timeZone: string): Date {
    RoutingUtils.assertValidDate(now);
    RoutingUtils.assertTimeZone(timeZone);
    const { minute, hour } = RoutingUtils.parseDailyCron(cron);
    return RoutingUtils.findNextLocalMinute(hour * 60 + minute, now, timeZone);
  }

  private static validateObject(value: JsonObject, path: string): void {
    for (const [key, constraint] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (Array.isArray(constraint)) {
        if (constraint.length === 0) {
          throw new RoutingPatternError(childPath, "match array cannot be empty");
        }
        for (const candidate of constraint) {
          RoutingUtils.validateMatcher(candidate, childPath);
        }
        continue;
      }

      if (!RoutingUtils.isObject(constraint)) {
        throw new RoutingPatternError(childPath, "must be a match array or nested object");
      }
      if (Object.keys(constraint).length === 0) {
        throw new RoutingPatternError(childPath, "nested object cannot be empty");
      }
      RoutingUtils.validateObject(constraint, childPath);
    }
  }

  private static validateMatcher(value: unknown, path: string): void {
    if (!RoutingUtils.isObject(value)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
      throw new RoutingPatternError(path, "contains an unsupported exact value");
    }

    const keys = Object.keys(value);
    if (keys.length !== 1 || !RoutingUtils.OPERATORS.has(keys[0] ?? "")) {
      throw new RoutingPatternError(path, "contains an unknown or malformed operator");
    }

    if ("prefix" in value) {
      if (typeof value.prefix !== "string" || value.prefix.length === 0) {
        throw new RoutingPatternError(path, "prefix must be a non-empty string");
      }
      return;
    }

    if ("exists" in value) {
      if (typeof value.exists !== "boolean") {
        throw new RoutingPatternError(path, "exists must be boolean");
      }
      return;
    }

    const numeric = value.numeric;
    if (!Array.isArray(numeric) || numeric.length === 0 || numeric.length % 2 !== 0) {
      throw new RoutingPatternError(path, "numeric must contain operator/value pairs");
    }
    for (let index = 0; index < numeric.length; index += 2) {
      if (
        !RoutingUtils.NUMERIC_OPERATORS.has(String(numeric[index]))
        || typeof numeric[index + 1] !== "number"
        || !Number.isFinite(numeric[index + 1])
      ) {
        throw new RoutingPatternError(path, "numeric contains an invalid comparison");
      }
    }
  }

  private static matchObject(pattern: JsonObject, candidate: JsonObject): boolean {
    return Object.entries(pattern).every(([key, constraint]) => {
      const resolved = RoutingUtils.resolve(candidate, key);
      if (Array.isArray(constraint)) {
        return RoutingUtils.matchConstraint(constraint, resolved.value, resolved.exists);
      }

      if (!RoutingUtils.isObject(constraint)) return false;
      if (!resolved.exists) return RoutingUtils.matchObject(constraint, {});
      if (Array.isArray(resolved.value)) {
        return resolved.value.some((value) => (
          RoutingUtils.isObject(value) && RoutingUtils.matchObject(constraint, value)
        ));
      }
      return RoutingUtils.isObject(resolved.value)
        && RoutingUtils.matchObject(constraint, resolved.value);
    });
  }

  private static matchConstraint(
    matchers: unknown[],
    candidate: unknown,
    exists: boolean,
  ): boolean {
    return matchers.some((matcher) => {
      if (RoutingUtils.isObject(matcher) && "exists" in matcher) {
        return matcher.exists === exists;
      }
      if (!exists) return false;

      const values = Array.isArray(candidate) ? candidate : [candidate];
      return values.some((value) => RoutingUtils.matchValue(matcher, value));
    });
  }

  private static matchValue(matcher: unknown, candidate: unknown): boolean {
    if (!RoutingUtils.isObject(matcher)) return Object.is(matcher, candidate);
    if ("prefix" in matcher) {
      return typeof candidate === "string"
        && candidate.startsWith(String(matcher.prefix));
    }
    if ("numeric" in matcher) {
      if (typeof candidate !== "number" || !Array.isArray(matcher.numeric)) return false;
      for (let index = 0; index < matcher.numeric.length; index += 2) {
        const operator = matcher.numeric[index];
        const operand = matcher.numeric[index + 1];
        if (typeof operand !== "number") return false;
        if (!RoutingUtils.compareNumber(candidate, String(operator), operand)) return false;
      }
      return true;
    }
    return false;
  }

  private static compareNumber(candidate: number, operator: string, operand: number): boolean {
    switch (operator) {
      case ">": return candidate > operand;
      case ">=": return candidate >= operand;
      case "<": return candidate < operand;
      case "<=": return candidate <= operand;
      case "=": return candidate === operand;
      case "!=": return candidate !== operand;
      default: return false;
    }
  }

  private static resolve(candidate: JsonObject, key: string): { exists: boolean; value: unknown } {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      return { exists: candidate[key] !== undefined, value: candidate[key] };
    }

    let current: unknown = candidate;
    for (const segment of key.split(".")) {
      if (!RoutingUtils.isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return { exists: false, value: undefined };
      }
      current = current[segment];
    }
    return { exists: current !== undefined, value: current };
  }

  private static parseClock(value: string, name: string): number {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    const hour = Number(match?.[1]);
    const minute = Number(match?.[2]);
    if (!match || hour > 23 || minute > 59) {
      throw new RoutingScheduleError(`${name} must use HH:mm in 24-hour time`);
    }
    return hour * 60 + minute;
  }

  private static parseDailyCron(cron: string): { minute: number; hour: number } {
    const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron.trim());
    const minute = Number(match?.[1]);
    const hour = Number(match?.[2]);
    if (!match || minute > 59 || hour > 23) {
      throw new RoutingScheduleError(
        "digest_flush_cron must be a daily cron in 'minute hour * * *' form",
      );
    }
    return { minute, hour };
  }

  private static nextLocalMinute(targetMinute: number, now: Date, timeZone: string): Date {
    return RoutingUtils.findNextLocalMinute(targetMinute, now, timeZone);
  }

  private static findNextLocalMinute(targetMinute: number, now: Date, timeZone: string): Date {
    const minuteMs = 60_000;
    let cursor = Math.floor(now.getTime() / minuteMs) * minuteMs + minuteMs;
    for (let checked = 0; checked < 60 * 72; checked += 1, cursor += minuteMs) {
      const parts = RoutingUtils.zonedParts(new Date(cursor), timeZone);
      if (parts.hour * 60 + parts.minute === targetMinute) return new Date(cursor);
    }
    throw new RoutingScheduleError("Could not find the next scheduled local time");
  }

  private static zonedParts(value: Date, timeZone: string): ZonedParts {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  }

  private static assertTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
    } catch {
      throw new RoutingScheduleError(`Invalid routing time zone: ${timeZone}`);
    }
  }

  private static assertValidDate(value: Date): void {
    if (Number.isNaN(value.getTime())) {
      throw new RoutingScheduleError("Routing clock returned an invalid date");
    }
  }

  private static isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
