import { Env } from "../../config/env.js";

export const digestConfig = {
  enabled: Env.boolean("DIGEST_SCHEDULER_ENABLED", true),
  pollIntervalMs: Env.integer("DIGEST_POLL_INTERVAL_MS", 60_000, { minimum: 1_000 }),
  visibilityTimeoutSeconds: Env.integer("DIGEST_VISIBILITY_TIMEOUT_SECONDS", 300),
  batchSize: Env.integer("DIGEST_BATCH_SIZE", 100, { maximum: 1_000 }),
  consumerName: process.env.DIGEST_CONSUMER_NAME?.trim() || "digest-scheduler",
} as const;
