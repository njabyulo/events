import { timingSafeEqual } from "node:crypto";
import {
  asJsonObject,
  type NormalizedWebhookEvent,
  type VerifiedWebhookRequest,
  type WebhookAdapter,
  WebhookError,
  type WebhookRequest,
} from "../webhook.types.js";

function equalSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function object(value: unknown, field: string) {
  const record = asJsonObject(value);
  if (!record) throw new WebhookError(400, "invalid_telegram_payload", `${field} is invalid`);
  return record;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actor(from: Record<string, unknown> | undefined): string | null {
  if (!from) return null;
  return text(from.username)
    || [text(from.first_name), text(from.last_name)].filter(Boolean).join(" ")
    || (typeof from.id === "number" ? String(from.id) : null);
}

export const telegramWebhookAdapter: WebhookAdapter = {
  provider: "telegram",

  async verify(request: WebhookRequest): Promise<void> {
    const received = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (!received || !equalSecret(request.secret, received)) {
      throw new WebhookError(401, "invalid_signature", "Telegram webhook secret is invalid");
    }
  },

  async normalize(request: VerifiedWebhookRequest): Promise<NormalizedWebhookEvent> {
    let update: Record<string, unknown>;
    try {
      update = object(JSON.parse(new TextDecoder().decode(request.rawBody)), "update");
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError(400, "invalid_telegram_payload", "Telegram body must be JSON");
    }
    if (!Number.isSafeInteger(update.update_id)) {
      throw new WebhookError(400, "invalid_telegram_payload", "update_id is required");
    }

    const callback = asJsonObject(update.callback_query);
    const message = asJsonObject(callback?.message) ?? asJsonObject(update.message);
    const from = asJsonObject(callback?.from) ?? asJsonObject(message?.from);
    const chat = asJsonObject(message?.chat);
    const date = typeof message?.date === "number"
      ? new Date(message.date * 1_000)
      : request.receivedAt;
    const chatId = typeof chat?.id === "number" ? String(chat.id) : null;
    const action = text(callback?.data);
    const body = text(message?.text) || text(message?.caption);
    const type = callback ? "telegram.action" : "telegram.message.received";
    const summary = callback
      ? `Telegram action: ${action || "unknown"}`
      : body || "Telegram message received";

    return {
      sourceEventId: String(update.update_id),
      sourceEventType: callback ? "callback_query" : "message",
      type,
      actor: actor(from),
      subject: chatId ? `telegram:${chatId}` : null,
      summary: summary.slice(0, 2_000),
      occurredAt: date.toISOString(),
      correlationId: chatId,
      causationEventId: null,
      traceId: null,
      detail: { update },
      attributes: {
        chat_id: chatId,
        message_id: typeof message?.message_id === "number" ? String(message.message_id) : null,
        callback_query_id: typeof callback?.id === "string" ? callback.id : null,
        action,
      },
      links: chatId ? [{ kind: "telegram_chat", value: chatId }] : [],
    };
  },
};
