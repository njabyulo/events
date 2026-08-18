function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export const telegramConfig = {
  enabled: process.env.TELEGRAM_CONSUMER_ENABLED?.toLowerCase() === "true",
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  chatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",
  queueName: process.env.TELEGRAM_QUEUE_NAME?.trim() || "telegram",
  consumerName: process.env.TELEGRAM_CONSUMER_NAME?.trim() || "telegram",
  apiBaseUrl: process.env.TELEGRAM_API_BASE_URL?.trim() || "https://api.telegram.org",
  pollIntervalMs: positiveInteger("TELEGRAM_POLL_INTERVAL_MS", 2_000, 100),
  visibilityTimeoutSeconds: positiveInteger("TELEGRAM_VISIBILITY_TIMEOUT_SECONDS", 60, 10),
  reconnectDelayMs: positiveInteger("TELEGRAM_RECONNECT_DELAY_MS", 5_000, 250),
  shutdownDeadlineMs: positiveInteger("TELEGRAM_SHUTDOWN_DEADLINE_MS", 10_000, 100),
} as const;

if (telegramConfig.enabled && (!telegramConfig.botToken || !telegramConfig.chatId)) {
  throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required when Telegram is enabled");
}
