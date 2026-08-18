import type { TelegramClient, TelegramMessage } from "core/telegram";
import { telegramConfig } from "./telegram.config.js";

export class TelegramHttpClient implements TelegramClient {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async sendMessage(message: TelegramMessage): Promise<{ messageId: string }> {
    const response = await this.request(
      `${this.baseUrl}/bot${this.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message.text,
          reply_markup: message.actions.length > 0 ? {
            inline_keyboard: message.actions.map((action) => [{
              text: action.label,
              callback_data: action.value,
            }]),
          } : undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const result = body.result && typeof body.result === "object"
      ? body.result as Record<string, unknown>
      : undefined;
    const messageId = result?.message_id;
    if (
      !response.ok
      || body.ok !== true
      || typeof messageId !== "number"
      || !Number.isSafeInteger(messageId)
    ) {
      throw new Error(`Telegram send failed (${response.status})`);
    }
    return { messageId: String(messageId) };
  }
}

export const telegramClient = new TelegramHttpClient(
  telegramConfig.botToken,
  telegramConfig.chatId,
  telegramConfig.apiBaseUrl,
);
