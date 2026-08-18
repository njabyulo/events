import { Env } from "../../config/env.js";

export const routerRuntimeConfig = {
  enabled: Env.boolean("ROUTER_ENABLED", true),
  eventsChannel: Env.channel("EVENTS_CHANNEL", "events_ready"),
  pollIntervalMs: Env.integer("ROUTER_POLL_INTERVAL_MS", 5_000, { minimum: 250 }),
  reconnectDelayMs: Env.integer("ROUTER_RECONNECT_DELAY_MS", 5_000, { minimum: 250 }),
} as const;
