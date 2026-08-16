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

  test("generates a source event ID when one is not supplied", () => {
    const event = EventsUtils.normalizeEnvelope({
      ...validEnvelope,
      sourceEventId: undefined,
    });

    expect(event.sourceEventId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
