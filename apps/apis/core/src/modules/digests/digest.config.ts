function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export const digestConfig = {
  enabled: process.env.DIGEST_SCHEDULER_ENABLED?.toLowerCase() !== "false",
  pollIntervalMs: positiveInteger("DIGEST_POLL_INTERVAL_MS", 60_000, 1_000),
  visibilityTimeoutSeconds: positiveInteger("DIGEST_VISIBILITY_TIMEOUT_SECONDS", 300),
  consumerName: process.env.DIGEST_CONSUMER_NAME?.trim() || "digest-scheduler",
} as const;
