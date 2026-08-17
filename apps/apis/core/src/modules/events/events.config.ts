import "dotenv/config";

const DEFAULT_MAX_EVENT_BODY_BYTES = 1_048_576;

export const DATABASE_URL = process.env.DATABASE_URL;
export const EVENTS_CHANNEL = process.env.EVENTS_CHANNEL || "events_ready";
export const SSE_CHANNEL = process.env.SSE_CHANNEL || "sse_ready";

if (!/^[a-z_][a-z0-9_$]*$/i.test(EVENTS_CHANNEL)) {
  throw new Error("EVENTS_CHANNEL must be a valid PostgreSQL identifier");
}

if (!/^[a-z_][a-z0-9_$]*$/i.test(SSE_CHANNEL)) {
  throw new Error("SSE_CHANNEL must be a valid PostgreSQL identifier");
}

export function maxEventBodyBytes(): number {
  const configured = Number(process.env.EVENT_MAX_BODY_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_EVENT_BODY_BYTES;
}
