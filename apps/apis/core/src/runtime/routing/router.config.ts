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

export const routerRuntimeConfig = {
  enabled: process.env.ROUTER_ENABLED?.toLowerCase() !== "false",
  eventsChannel: channel("EVENTS_CHANNEL", "events_ready"),
  pollIntervalMs: positiveInteger("ROUTER_POLL_INTERVAL_MS", 5_000, 250),
  reconnectDelayMs: positiveInteger("ROUTER_RECONNECT_DELAY_MS", 5_000, 250),
} as const;
