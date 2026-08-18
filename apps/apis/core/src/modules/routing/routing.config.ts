import "dotenv/config";

function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export const routerConfig = {
  leaseMs: positiveInteger("ROUTER_LEASE_MS", 30_000, 1_000),
  retryBaseMs: positiveInteger("ROUTER_RETRY_BASE_MS", 1_000, 1),
  retryMaxMs: positiveInteger("ROUTER_RETRY_MAX_MS", 60_000, 1),
  timeZone: process.env.ROUTER_TIME_ZONE?.trim() || "Africa/Johannesburg",
  quietHoursStart: process.env.QUIET_HOURS_START?.trim() || "21:00",
  quietHoursEnd: process.env.QUIET_HOURS_END?.trim() || "07:00",
  smsReadiness: {
    twilioCredentialsPresent: Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim()
      && process.env.TWILIO_AUTH_TOKEN?.trim()
      && process.env.TWILIO_FROM_NUMBER?.trim(),
    ),
    destinationPresent: Boolean(process.env.SMS_DESTINATION_NUMBER?.trim()),
    rateLimitConfigured: positiveInteger("SMS_ESCALATION_RATE_LIMIT_PER_HOUR", 0) > 0,
  },
} as const;
