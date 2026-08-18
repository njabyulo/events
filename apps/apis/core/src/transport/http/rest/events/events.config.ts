import { Env } from "../../../../config/env.js";

const DEFAULT_MAX_EVENT_BODY_BYTES = 1_048_576;

export function maxEventBodyBytes(): number {
  return Env.integer("EVENT_MAX_BODY_BYTES", DEFAULT_MAX_EVENT_BODY_BYTES);
}
