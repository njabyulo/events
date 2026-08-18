import { describe, expect, test, vi } from "vitest";
import { TelegramHttpClient } from "../../../src/integrations/telegram/telegram.client.js";

describe("TelegramHttpClient", () => {
  test("sends actions as inline keyboard callback data", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 42 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new TelegramHttpClient(
      "test-token",
      "123",
      "https://telegram.example",
      request as typeof fetch,
    );

    await expect(client.sendMessage({
      text: "Deployment failed",
      actions: [{ label: "Review", value: "event.review:101" }],
    })).resolves.toEqual({ messageId: "42" });
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      chat_id: "123",
      reply_markup: {
        inline_keyboard: [[{ text: "Review", callback_data: "event.review:101" }]],
      },
    });
  });
});
