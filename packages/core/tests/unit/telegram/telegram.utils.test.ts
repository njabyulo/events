import type { StoredEvent } from "database/events";
import { describe, expect, test } from "vitest";
import { TelegramUtils } from "../../../src/telegram/telegram.utils.js";

const event: StoredEvent = {
  id: "101",
  source: "classifier",
  sourceEventId: "classified-100",
  type: "deployment.failed",
  subject: "api-core",
  actor: "github-actions",
  summary: "Production deployment failed",
  occurredAt: "2026-08-17T10:00:00.000Z",
  ingestedAt: "2026-08-17T10:00:01.000Z",
  correlationId: null,
  causationEventId: "100",
  traceId: null,
  detail: {},
  attributes: {
    domain: "career",
    priority: "urgent",
    actions: [
      { label: "Review", value: "event.review:100" },
      { label: "Snooze", value: "event.snooze:100" },
    ],
  },
  links: [],
};

describe("TelegramUtils", () => {
  test("creates a bounded message and inline keyboard actions", () => {
    expect(TelegramUtils.message(event)).toEqual({
      text: "[events] URGENT · career\nProduction deployment failed",
      actions: [
        { label: "Review", value: "event.review:100" },
        { label: "Snooze", value: "event.snooze:100" },
      ],
    });
  });

  test("bounds callback data by UTF-8 bytes without splitting characters", () => {
    const unicodeEvent: StoredEvent = {
      ...event,
      attributes: {
        actions: [{ label: "Open", value: "🙂".repeat(40) }],
      },
    };

    const [action] = TelegramUtils.message(unicodeEvent).actions;

    expect(Buffer.byteLength(action!.value)).toBeLessThanOrEqual(64);
    expect(action!.value).toBe("🙂".repeat(16));
  });
});
