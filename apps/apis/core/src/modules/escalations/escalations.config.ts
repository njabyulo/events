function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export const escalationsConfig = {
  enabled: process.env.SMS_ESCALATION_ENABLED?.toLowerCase() === "true",
  accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || "",
  authToken: process.env.TWILIO_AUTH_TOKEN?.trim() || "",
  fromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || "",
  destinationNumber: process.env.SMS_DESTINATION_NUMBER?.trim() || "",
  apiBaseUrl: process.env.TWILIO_API_BASE_URL?.trim() || "https://api.twilio.com",
  pollIntervalMs: positiveInteger("SMS_ESCALATION_POLL_INTERVAL_MS", 5_000, 250),
  leaseSeconds: positiveInteger("SMS_ESCALATION_LEASE_SECONDS", 60, 10),
  maxAttempts: positiveInteger("SMS_ESCALATION_MAX_ATTEMPTS", 5),
  rateLimitPerHour: positiveInteger("SMS_ESCALATION_RATE_LIMIT_PER_HOUR", 3),
  rateLimitPerDay: positiveInteger("SMS_ESCALATION_RATE_LIMIT_PER_DAY", 10),
} as const;

if (
  escalationsConfig.enabled
  && ![
    escalationsConfig.accountSid,
    escalationsConfig.authToken,
    escalationsConfig.fromNumber,
    escalationsConfig.destinationNumber,
  ].every(Boolean)
) {
  throw new Error("Twilio credentials, source, and destination are required when SMS is enabled");
}
