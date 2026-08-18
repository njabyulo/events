import "dotenv/config";
import { Env } from "../../config/env.js";

export const routerConfig = {
  leaseMs: Env.integer("ROUTER_LEASE_MS", 30_000, { minimum: 1_000 }),
  retryBaseMs: Env.integer("ROUTER_RETRY_BASE_MS", 1_000),
  retryMaxMs: Env.integer("ROUTER_RETRY_MAX_MS", 60_000),
  maxAttempts: Env.integer("ROUTER_MAX_ATTEMPTS", 10),
  replayBatchSize: Env.integer("REPLAY_BATCH_SIZE", 100, { maximum: 1_000 }),
  replayLeaseSeconds: Env.integer("REPLAY_LEASE_SECONDS", 60),
  replayMaxAttempts: Env.integer("REPLAY_MAX_ATTEMPTS", 5),
  replayRetryDelaySeconds: Env.integer("REPLAY_RETRY_DELAY_SECONDS", 5),
  timeZone: Env.timeZone("ROUTER_TIME_ZONE", "Africa/Johannesburg"),
  quietHoursStart: Env.clock("QUIET_HOURS_START", "21:00"),
  quietHoursEnd: Env.clock("QUIET_HOURS_END", "07:00"),
  smsReadiness: {
    twilioCredentialsPresent: Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim()
      && process.env.TWILIO_AUTH_TOKEN?.trim()
      && process.env.TWILIO_FROM_NUMBER?.trim(),
    ),
    destinationPresent: Boolean(process.env.SMS_DESTINATION_NUMBER?.trim()),
    rateLimitConfigured: Env.integer(
      "SMS_ESCALATION_RATE_LIMIT_PER_HOUR",
      0,
      { minimum: 0 },
    ) > 0,
  },
} as const;
