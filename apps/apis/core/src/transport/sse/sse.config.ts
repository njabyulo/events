import { Env } from "../../config/env.js";

export const sseConfig = {
  databaseUrl: process.env.DATABASE_URL?.trim(),
  channel: Env.channel("SSE_CHANNEL", "sse_ready"),
  heartbeatMs: Env.integer("SSE_HEARTBEAT_MS", 15_000, { minimum: 1_000 }),
  reconnectDelayMs: Env.integer("SSE_RECONNECT_DELAY_MS", 5_000, { minimum: 250 }),
  maxClients: Env.integer("SSE_MAX_CLIENTS", 25),
  maxFrameBytes: Env.integer("SSE_MAX_FRAME_BYTES", 262_144, { minimum: 1_024 }),
} as const;
