import { Env } from "../../config/env.js";

export const escalationsConfig = {
  enabled: Env.boolean("SMS_ESCALATION_ENABLED", false),
  accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || "",
  authToken: process.env.TWILIO_AUTH_TOKEN?.trim() || "",
  fromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || "",
  destinationNumber: process.env.SMS_DESTINATION_NUMBER?.trim() || "",
  apiBaseUrl: process.env.TWILIO_API_BASE_URL?.trim() || "https://api.twilio.com",
  pollIntervalMs: Env.integer("SMS_ESCALATION_POLL_INTERVAL_MS", 5_000, { minimum: 250 }),
  leaseSeconds: Env.integer("SMS_ESCALATION_LEASE_SECONDS", 60, { minimum: 10 }),
  maxAttempts: Env.integer("SMS_ESCALATION_MAX_ATTEMPTS", 5),
  rateLimitPerHour: Env.integer("SMS_ESCALATION_RATE_LIMIT_PER_HOUR", 3),
  rateLimitPerDay: Env.integer("SMS_ESCALATION_RATE_LIMIT_PER_DAY", 10),
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
