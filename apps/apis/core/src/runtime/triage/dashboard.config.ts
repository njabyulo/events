import { Env } from "../../config/env.js";

export const dashboardConfig = {
  consumerEnabled: Env.boolean("DASHBOARD_CONSUMER_ENABLED", true),
  queueNames: (process.env.DASHBOARD_QUEUE_NAMES || (
    Env.boolean("AGENT_ENABLED", false)
      ? "career,personal"
      : "career,personal,unclassified"
  ))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
  consumerName: process.env.DASHBOARD_CONSUMER_NAME?.trim() || "dashboard",
  queueChannel: Env.channel("QUEUE_CHANNEL", "queue_ready"),
  pollIntervalMs: Env.integer("DASHBOARD_POLL_INTERVAL_MS", 2_000, { minimum: 100 }),
  reconnectDelayMs: Env.integer("DASHBOARD_RECONNECT_DELAY_MS", 5_000, { minimum: 250 }),
  visibilityTimeoutSeconds: Env.integer("DASHBOARD_VISIBILITY_TIMEOUT_SECONDS", 300),
  heartbeatIntervalMs: Env.integer("DASHBOARD_HEARTBEAT_INTERVAL_MS", 100_000, { minimum: 1_000 }),
  maxConcurrency: Env.integer("DASHBOARD_MAX_CONCURRENCY", 4),
  maxDeferred: Env.integer("DASHBOARD_MAX_DEFERRED", 500),
  shutdownDeadlineMs: Env.integer("DASHBOARD_SHUTDOWN_DEADLINE_MS", 10_000, { minimum: 100 }),
} as const;

if (dashboardConfig.heartbeatIntervalMs >= dashboardConfig.visibilityTimeoutSeconds * 1_000) {
  throw new Error("DASHBOARD_HEARTBEAT_INTERVAL_MS must be shorter than visibility timeout");
}
