import { describe, expect, test } from "vitest";
import {
  EventValidationError,
  EventsUtils,
} from "../../../src/events/events.service.js";

const validEnvelope = {
  source: "github.career",
  sourceEventId: "delivery-1",
  type: "pull_request.merged",
  occurredAt: "2026-08-16T12:00:00Z",
  detail: { raw: {} },
};

describe("EventsUtils", () => {
  test("normalizes a canonical event and removes duplicate links", () => {
    const event = EventsUtils.normalizeEnvelope({
      ...validEnvelope,
      causationEventId: 42,
      links: [
        { kind: "repository", value: "owner/repo" },
        { kind: "repository", value: "owner/repo" },
      ],
    });

    expect(event.occurredAt).toBe("2026-08-16T12:00:00.000Z");
    expect(event.causationEventId).toBe("42");
    expect(event.links).toEqual([
      { kind: "repository", value: "owner/repo" },
    ]);
  });

  test.each([
    [{ ...validEnvelope, source: "GitHub" }, "invalid_source"],
    [{ ...validEnvelope, type: "merged" }, "invalid_event_type"],
    [{ ...validEnvelope, occurredAt: "tomorrow" }, "invalid_occurred_at"],
    [{ ...validEnvelope, links: [{ kind: "Bad Kind", value: "x" }] }, "invalid_event_links"],
  ])("rejects an invalid envelope", (envelope, code) => {
    expect(() => EventsUtils.normalizeEnvelope(envelope)).toThrowError(
      expect.objectContaining<EventValidationError>({ code }),
    );
  });

  test("requires a source event ID so producer retries remain idempotent", () => {
    expect(() => EventsUtils.normalizeEnvelope({
      ...validEnvelope,
      sourceEventId: undefined,
    })).toThrowError(expect.objectContaining<EventValidationError>({ code: "invalid_event" }));
  });

  test("preserves bigint IDs represented as strings", () => {
    const event = EventsUtils.normalizeEnvelope({
      ...validEnvelope,
      causationEventId: "9223372036854775807",
    });

    expect(event.causationEventId).toBe("9223372036854775807");
    expect(() => EventsUtils.normalizeEnvelope({
      ...validEnvelope,
      causationEventId: 9_223_372_036_854_775_807,
    })).toThrowError(expect.objectContaining<EventValidationError>({
      code: "invalid_causation_event_id",
    }));
  });

  test("rejects timestamps beyond the accepted producer clock skew", () => {
    expect(() => EventsUtils.normalizeEnvelope({
      ...validEnvelope,
      occurredAt: new Date(Date.now() + 301_000).toISOString(),
    })).toThrowError(expect.objectContaining<EventValidationError>({
      code: "occurred_at_in_future",
    }));
  });
});
