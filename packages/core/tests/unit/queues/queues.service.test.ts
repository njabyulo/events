import { describe, expect, test, vi } from "vitest";
import { createQueuesService } from "../../../src/queues/queues.service.js";

describe("QueuesService retries", () => {
  test("turns a NACK into bounded exponential backoff with jitter", async () => {
    const nackMessage = vi.fn(async () => true);
    const service = createQueuesService(
      { nackMessage } as never,
      { random: () => 0.5 },
    );

    await service.nackMessage("1", "2", {
      receiptHandle: "00000000-0000-4000-8000-000000000001",
      consumerName: "failure-demo",
      receiveCount: 3,
      error: new Error("temporary failure"),
    });

    expect(nackMessage).toHaveBeenCalledWith({
      queueId: "1",
      messageId: "2",
      receiptHandle: "00000000-0000-4000-8000-000000000001",
      consumerName: "failure-demo",
      delaySeconds: 22,
      error: "temporary failure",
    });
  });
});
