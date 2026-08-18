const DEFAULT_MAX_EVENT_BODY_BYTES = 1_048_576;

export function maxEventBodyBytes(): number {
  const configured = Number(process.env.EVENT_MAX_BODY_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_EVENT_BODY_BYTES;
}
