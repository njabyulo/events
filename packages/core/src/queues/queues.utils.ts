import type { Priority } from "database/queues";
import { QueueValidationError } from "./queue.errors.js";

export class QueuesUtils {
  static retryDelaySeconds(
    receiveCount: number,
    random = Math.random,
    baseSeconds = 5,
    maximumSeconds = 900,
  ): number {
    const exponent = Math.max(0, Math.min(receiveCount - 1, 30));
    const backoff = Math.min(maximumSeconds, baseSeconds * (2 ** exponent));
    const jitter = Math.floor(random() * Math.max(1, Math.ceil(backoff * 0.2)));
    return Math.min(maximumSeconds, backoff + jitter);
  }

  static boundedError(value: unknown): string {
    const message = value instanceof Error ? value.message : String(value ?? "Processing failed");
    return message.replace(/\s+/g, " ").trim().slice(0, 500) || "Processing failed";
  }

  static id(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
      throw new QueueValidationError(`invalid_${field}`, `${field} must be a positive ID`);
    }
    return value;
  }

  static name(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new QueueValidationError("invalid_queue_name", "Queue name is required");
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) {
      throw new QueueValidationError(
        "invalid_queue_name",
        "Queue name must use letters, numbers, dots, underscores, or hyphens",
      );
    }
    return normalized;
  }

  static optionalBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      throw new QueueValidationError("invalid_boolean", "Expected a boolean value");
    }
    return value;
  }

  static integer(
    value: unknown,
    field: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
      throw new QueueValidationError(
        `invalid_${field}`,
        `${field} must be an integer from ${minimum} to ${maximum}`,
      );
    }
    return Number(value);
  }

  static nullableText(value: unknown, field: string, maxLength: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.trim().length > maxLength) {
      throw new QueueValidationError(`invalid_${field}`, `${field} is invalid`);
    }
    return value.trim();
  }

  static messageGroupId(value: unknown): string {
    if (value === undefined) return "default";
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
      throw new QueueValidationError(
        "invalid_message_group_id",
        "messageGroupId must be 1 to 128 characters",
      );
    }
    return value.trim();
  }

  static priority(value: unknown): Priority {
    if (value === undefined) return "normal";
    if (value !== "urgent" && value !== "normal" && value !== "low") {
      throw new QueueValidationError(
        "invalid_priority",
        "priority must be urgent, normal, or low",
      );
    }
    return value;
  }

  static receiptHandle(value: unknown): string {
    if (
      typeof value !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ) {
      throw new QueueValidationError(
        "invalid_receipt_handle",
        "receiptHandle must be a UUID",
      );
    }
    return value;
  }

  static consumerName(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 120) {
      throw new QueueValidationError(
        "invalid_consumer_name",
        "consumerName must be 1 to 120 characters",
      );
    }
    return value.trim();
  }

  static isUniqueViolation(error: unknown): boolean {
    return Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "23505",
    );
  }
}
