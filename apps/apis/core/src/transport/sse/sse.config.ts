const channel = process.env.SSE_CHANNEL?.trim() || "sse_ready";

function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

if (!/^[a-z_][a-z0-9_$]*$/i.test(channel)) {
  throw new Error("SSE_CHANNEL must be a valid PostgreSQL identifier");
}

export const sseConfig = {
  databaseUrl: process.env.DATABASE_URL?.trim(),
  channel,
  heartbeatMs: positiveInteger("SSE_HEARTBEAT_MS", 15_000, 1_000),
  reconnectDelayMs: positiveInteger("SSE_RECONNECT_DELAY_MS", 5_000, 250),
  maxClients: positiveInteger("SSE_MAX_CLIENTS", 25),
  maxFrameBytes: positiveInteger("SSE_MAX_FRAME_BYTES", 262_144, 1_024),
} as const;
