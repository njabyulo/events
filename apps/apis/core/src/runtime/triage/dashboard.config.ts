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

export const dashboardConfig = {
  consumerEnabled: process.env.DASHBOARD_CONSUMER_ENABLED?.toLowerCase() !== "false",
  queueNames: (process.env.DASHBOARD_QUEUE_NAMES || (
    process.env.AGENT_ENABLED?.toLowerCase() === "true"
      ? "career,personal"
      : "career,personal,unclassified"
  ))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
  consumerName: process.env.DASHBOARD_CONSUMER_NAME?.trim() || "dashboard",
  queueChannel: channel("QUEUE_CHANNEL", "queue_ready"),
  pollIntervalMs: positiveInteger("DASHBOARD_POLL_INTERVAL_MS", 2_000, 100),
  reconnectDelayMs: positiveInteger("DASHBOARD_RECONNECT_DELAY_MS", 5_000, 250),
  visibilityTimeoutSeconds: positiveInteger("DASHBOARD_VISIBILITY_TIMEOUT_SECONDS", 300),
  heartbeatIntervalMs: positiveInteger("DASHBOARD_HEARTBEAT_INTERVAL_MS", 100_000, 1_000),
  maxConcurrency: positiveInteger("DASHBOARD_MAX_CONCURRENCY", 4),
  maxDeferred: positiveInteger("DASHBOARD_MAX_DEFERRED", 500),
  shutdownDeadlineMs: positiveInteger("DASHBOARD_SHUTDOWN_DEADLINE_MS", 10_000, 100),
} as const;

if (dashboardConfig.heartbeatIntervalMs >= dashboardConfig.visibilityTimeoutSeconds * 1_000) {
  throw new Error("DASHBOARD_HEARTBEAT_INTERVAL_MS must be shorter than visibility timeout");
}
