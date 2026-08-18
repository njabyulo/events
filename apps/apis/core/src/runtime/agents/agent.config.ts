function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export const agentRuntimeConfig = {
  enabled: process.env.AGENT_ENABLED?.toLowerCase() === "true",
  queueName: process.env.AGENT_QUEUE_NAME?.trim() || "unclassified",
  consumerName: process.env.AGENT_CONSUMER_NAME?.trim() || "strands-agent",
  maxConcurrency: positiveInteger("AGENT_MAX_CONCURRENCY", 2),
  pollIntervalMs: positiveInteger("AGENT_POLL_INTERVAL_MS", 2_000, 100),
  visibilityTimeoutSeconds: positiveInteger("AGENT_VISIBILITY_TIMEOUT_SECONDS", 180, 30),
  heartbeatIntervalMs: positiveInteger("AGENT_HEARTBEAT_INTERVAL_MS", 60_000, 1_000),
  reconnectDelayMs: positiveInteger("AGENT_RECONNECT_DELAY_MS", 5_000, 250),
  shutdownDeadlineMs: positiveInteger("AGENT_SHUTDOWN_DEADLINE_MS", 10_000, 100),
} as const;

if (
  agentRuntimeConfig.heartbeatIntervalMs
  >= agentRuntimeConfig.visibilityTimeoutSeconds * 1_000
) {
  throw new Error("AGENT_HEARTBEAT_INTERVAL_MS must be shorter than visibility timeout");
}
