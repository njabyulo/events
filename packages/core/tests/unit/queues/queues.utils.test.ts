import { describe, expect, test } from "vitest";
import { QueueValidationError } from "../../../src/queues/queue.errors.js";
import { QueuesUtils } from "../../../src/queues/queues.utils.js";

describe("QueuesUtils", () => {
  test("calculates capped exponential retry backoff with jitter", () => {
    expect(QueuesUtils.retryDelaySeconds(1, () => 0)).toBe(5);
    expect(QueuesUtils.retryDelaySeconds(3, () => 0.99)).toBe(23);
    expect(QueuesUtils.retryDelaySeconds(100, () => 0.99)).toBe(900);
  });

  test("bounds retry error metadata", () => {
    expect(QueuesUtils.boundedError(new Error("  retry\nfailed  "))).toBe("retry failed");
    expect(QueuesUtils.boundedError("x".repeat(1_000))).toHaveLength(500);
  });

  test("normalizes queue names and priorities", () => {
    expect(QueuesUtils.name(" Career.Urgent ")).toBe("career.urgent");
    expect(QueuesUtils.priority("urgent")).toBe("urgent");
  });

  test("rejects unbounded receive and visibility values", () => {
    expect(() => QueuesUtils.integer(11, "max_messages", 1, 1, 10))
      .toThrow(QueueValidationError);
    expect(() => QueuesUtils.integer(0, "visibility", 30, 1, 43_200))
      .toThrow(QueueValidationError);
  });

  test("requires UUID receipt handles", () => {
    expect(() => QueuesUtils.receiptHandle("stale-handle"))
      .toThrow(QueueValidationError);
    expect(QueuesUtils.receiptHandle("00000000-0000-4000-8000-000000000001"))
      .toBe("00000000-0000-4000-8000-000000000001");
  });
});
