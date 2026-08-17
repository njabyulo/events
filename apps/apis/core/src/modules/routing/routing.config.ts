import "dotenv/config";

function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function channel(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[a-z_][a-z0-9_$]*$/i.test(value)) {
    throw new Error(`${name} must be a valid PostgreSQL identifier`);
  }
  return value;
}

export const routerConfig = {
  enabled: process.env.ROUTER_ENABLED?.toLowerCase() !== "false",
  eventsChannel: channel("EVENTS_CHANNEL", "events_ready"),
  sseChannel: channel("SSE_CHANNEL", "sse_ready"),
  pollIntervalMs: positiveInteger("ROUTER_POLL_INTERVAL_MS", 5_000, 250),
  reconnectDelayMs: positiveInteger("ROUTER_RECONNECT_DELAY_MS", 5_000, 250),
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
