import { WebhookError } from "./webhook.types.js";

export function requiredHeader(headers: Headers, name: string) {
  const value = headers.get(name)?.trim();
  if (!value) throw new WebhookError(400, "missing_header", `Missing ${name} header`);
  return value;
}
