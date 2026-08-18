import { describe, expect, test } from "vitest";
import { SseUtils } from "../../../src/transport/sse/sse.utils.js";

describe("SseUtils", () => {
  test("accepts only PostgreSQL bigint cursors", () => {
    expect(SseUtils.cursor("9223372036854775807")).toBe("9223372036854775807");
    expect(SseUtils.cursor("9223372036854775808")).toBe("0");
    expect(SseUtils.cursor("not-an-id")).toBe("0");
  });

  test("keeps a bounded stream message intact", () => {
    const message = { id: "12", eventName: "triage.item.available", summary: "Ready" };

    expect(SseUtils.frame(message, 1_024)).toEqual({
      id: "12",
      event: "triage.item.available",
      data: JSON.stringify(message),
      skipped: false,
    });
  });

  test("advances replay with a bounded marker instead of poisoning the cursor", () => {
    const frame = SseUtils.frame({
      id: "13",
      eventName: "triage.item.available",
      detail: "x".repeat(2_000),
    }, 1_024);

    expect(frame).toMatchObject({
      id: "13",
      event: "stream.message.skipped",
      skipped: true,
    });
    expect(Buffer.byteLength(frame.data)).toBeLessThan(1_024);
    expect(JSON.parse(frame.data)).toMatchObject({
      streamMessageId: "13",
      reason: "frame_too_large",
    });
  });
});
