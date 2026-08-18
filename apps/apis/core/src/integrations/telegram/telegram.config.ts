import { Env } from "../../config/env.js";

export const telegramConfig = {
  enabled: Env.boolean("TELEGRAM_CONSUMER_ENABLED", false),
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  chatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",
  queueName: process.env.TELEGRAM_QUEUE_NAME?.trim() || "telegram",
  consumerName: process.env.TELEGRAM_CONSUMER_NAME?.trim() || "telegram",
  apiBaseUrl: process.env.TELEGRAM_API_BASE_URL?.trim() || "https://api.telegram.org",
  pollIntervalMs: Env.integer("TELEGRAM_POLL_INTERVAL_MS", 2_000, { minimum: 100 }),
  visibilityTimeoutSeconds: Env.integer("TELEGRAM_VISIBILITY_TIMEOUT_SECONDS", 60, { minimum: 10 }),
  reconnectDelayMs: Env.integer("TELEGRAM_RECONNECT_DELAY_MS", 5_000, { minimum: 250 }),
  shutdownDeadlineMs: Env.integer("TELEGRAM_SHUTDOWN_DEADLINE_MS", 10_000, { minimum: 100 }),
} as const;

if (telegramConfig.enabled && (!telegramConfig.botToken || !telegramConfig.chatId)) {
  throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required when Telegram is enabled");
}
