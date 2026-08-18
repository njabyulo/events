import { Env } from "../../config/env.js";

export const agentRuntimeConfig = {
  enabled: Env.boolean("AGENT_ENABLED", false),
  queueName: process.env.AGENT_QUEUE_NAME?.trim() || "unclassified",
  consumerName: process.env.AGENT_CONSUMER_NAME?.trim() || "strands-agent",
  maxConcurrency: Env.integer("AGENT_MAX_CONCURRENCY", 2),
  pollIntervalMs: Env.integer("AGENT_POLL_INTERVAL_MS", 2_000, { minimum: 100 }),
  visibilityTimeoutSeconds: Env.integer("AGENT_VISIBILITY_TIMEOUT_SECONDS", 180, { minimum: 30 }),
  heartbeatIntervalMs: Env.integer("AGENT_HEARTBEAT_INTERVAL_MS", 60_000, { minimum: 1_000 }),
  reconnectDelayMs: Env.integer("AGENT_RECONNECT_DELAY_MS", 5_000, { minimum: 250 }),
  shutdownDeadlineMs: Env.integer("AGENT_SHUTDOWN_DEADLINE_MS", 10_000, { minimum: 100 }),
} as const;

if (
  agentRuntimeConfig.heartbeatIntervalMs
  >= agentRuntimeConfig.visibilityTimeoutSeconds * 1_000
) {
  throw new Error("AGENT_HEARTBEAT_INTERVAL_MS must be shorter than visibility timeout");
}
