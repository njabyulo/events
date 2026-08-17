import { describe, expect, test } from "vitest";
import type { QueueRecord, StoredEvent } from "../../../src/routing/index.js";
import {
  RoutingPatternError,
  RoutingUtils,
} from "../../../src/routing/index.js";

const event: StoredEvent = {
  id: "42",
  source: "github",
  sourceEventId: "delivery-42",
  type: "pull_request.review_requested",
  subject: "employer-org/platform#42",
  actor: "octocat",
  summary: "Review requested",
  occurredAt: "2026-08-16T12:00:00.000Z",
  ingestedAt: "2026-08-16T12:00:01.000Z",
  correlationId: null,
  causationEventId: null,
  traceId: "trace-42",
  detail: {
    pullRequest: {
      additions: 120,
      draft: false,
    },
  },
  attributes: { schemaVersion: 1, labels: ["backend", "urgent"] },
  links: [
    { kind: "repository", value: "employer-org/platform" },
    { kind: "pull_request", value: "employer-org/platform#42" },
  ],
};

const queue: QueueRecord = {
  id: "1",
  name: "career",
  fifo: true,
  visibilityTimeoutSeconds: 30,
  maxReceiveCount: 3,
  retentionSeconds: 1_209_600,
  escalate: false,
  quietHours: true,
  digestFlushCron: null,
  createdAt: "2026-08-16T00:00:00.000Z",
  deletedAt: null,
};

describe("EventBridge-style routing patterns", () => {
  test("matches exact values, accepted arrays, and nested objects", () => {
    expect(RoutingUtils.matches({
      source: ["gmail", "github"],
      type: ["pull_request.review_requested"],
      attributes: { schemaVersion: [1], labels: ["urgent"] },
      detail: { pullRequest: { draft: [false] } },
    }, event)).toBe(true);
  });

  test("matches prefixes across event links", () => {
    expect(RoutingUtils.matches({
      subject: [{ prefix: "employer-org/" }],
      links: { repository: [{ prefix: "employer-org/" }] },
    }, event)).toBe(true);
    expect(RoutingUtils.matches({
      links: { repository: [{ prefix: "personal/" }] },
    }, event)).toBe(false);
  });

  test("matches exists and does-not-exist without treating null as absent", () => {
    expect(RoutingUtils.matches({
      detail: { pullRequest: { additions: [{ exists: true }] } },
      attributes: { missing: [{ exists: false }] },
      links: { deployment: { url: [{ exists: false }] } },
      correlationId: [null],
    }, event)).toBe(true);
  });

  test("matches numeric comparison chains and dotted nested paths", () => {
    expect(RoutingUtils.matches({
      detail: {
        "pullRequest.additions": [{ numeric: [">=", 100, "<", 200] }],
      },
    }, event)).toBe(true);
    expect(RoutingUtils.matches({
      detail: { pullRequest: { additions: [{ numeric: [">", 500] }] } },
    }, event)).toBe(false);
  });

  test("rejects malformed or unknown operators", () => {
    expect(() => RoutingUtils.matches({ source: [{ suffix: "hub" }] }, event))
      .toThrow(RoutingPatternError);
    expect(() => RoutingUtils.matches({ source: [] }, event))
      .toThrow("match array cannot be empty");
  });
});

describe("routing visibility scheduling", () => {
  const johannesburg = {
    timeZone: "Africa/Johannesburg",
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
  };

  test("holds normal priority at 22:00 until 07:00 the next day", () => {
    const now = new Date("2026-08-16T20:00:00.000Z");
    expect(RoutingUtils.computeVisibleAt("normal", queue, now, johannesburg).toISOString())
      .toBe("2026-08-17T05:00:00.000Z");
  });

  test("urgent priority bypasses quiet hours", () => {
    const now = new Date("2026-08-16T20:00:12.345Z");
    expect(RoutingUtils.computeVisibleAt("urgent", queue, now, johannesburg).toISOString())
      .toBe(now.toISOString());
  });

  test("low priority in digest waits for the next cron occurrence", () => {
    const digest = { ...queue, name: "digest", quietHours: false, digestFlushCron: "0 7 * * *" };
    const now = new Date("2026-08-16T06:00:00.000Z");
    expect(RoutingUtils.computeVisibleAt("low", digest, now, johannesburg).toISOString())
      .toBe("2026-08-17T05:00:00.000Z");
  });

  test.each([
    ["spring forward", "2026-03-08T06:30:00.000Z", "2026-03-08T11:00:00.000Z"],
    ["fall back", "2026-11-01T05:30:00.000Z", "2026-11-01T12:00:00.000Z"],
  ])("uses wall-clock 07:00 across %s", (_label, now, expected) => {
    expect(RoutingUtils.computeVisibleAt("normal", queue, new Date(now), {
      timeZone: "America/New_York",
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
    }).toISOString()).toBe(expected);
  });
});
