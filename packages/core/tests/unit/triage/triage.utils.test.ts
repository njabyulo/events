import type { StoredEvent } from "database/events";
import { describe, expect, test } from "vitest";
import { TriageUtils } from "../../../src/triage/triage.utils.js";

function event(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "1",
    source: "github",
    sourceEventId: "delivery-1",
    type: "pull_request.review_requested",
    subject: "example/service#42",
    actor: "octocat",
    summary: "Review requested on #42",
    occurredAt: "2026-08-17T10:00:00.000Z",
    ingestedAt: "2026-08-17T10:00:01.000Z",
    correlationId: null,
    causationEventId: null,
    traceId: null,
    detail: {},
    attributes: {},
    links: [{ kind: "pull_request", value: "example/service#42" }],
    ...overrides,
  };
}

describe("TriageUtils", () => {
  test("produces a deterministic triage contract from source and type", () => {
    expect(TriageUtils.decide(event(), "unclassified")).toEqual({
      domain: "career",
      priority: "urgent",
      channel: "web",
      brief: "Review requested on #42",
      decidedBy: "rule-stub",
      reason: "rule-stub:github:pull_request.review_requested",
    });
  });

  test("sends low urgency source events to the digest channel", () => {
    expect(TriageUtils.decide(event({ type: "branch.deleted" }), "career"))
      .toMatchObject({ priority: "low", channel: "digest" });
  });

  test("honors a domain encoded in a configured source name", () => {
    expect(TriageUtils.decide(event({ source: "github.personal" }), "career"))
      .toMatchObject({ domain: "personal" });
  });

  test("groups events by the most specific stable event link", () => {
    const key = TriageUtils.threadKey(event({
      links: [
        { kind: "repository", value: "example/service" },
        { kind: "pull_request", value: "example/service#42" },
      ],
    }));
    expect(key).toBe("github:pull_request:example/service#42");
  });
});
