import { Env } from "../../config/env.js";

export const maintenanceConfig = {
  enabled: Env.boolean("MAINTENANCE_ENABLED", true),
  pollIntervalMs: Env.integer("MAINTENANCE_POLL_INTERVAL_MS", 60_000, { minimum: 1_000 }),
  batchSize: Env.integer("MAINTENANCE_BATCH_SIZE", 100, { maximum: 1_000 }),
  streamRetentionSeconds: Env.integer("SSE_DEFAULT_RETENTION_SECONDS", 604_800),
} as const;
