import { RoutingValidationError } from "core/routing";
import type { Context } from "hono";

export async function jsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new RoutingValidationError("invalid_payload", "Body must be a JSON object");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RoutingValidationError("invalid_payload", "Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function pathParam(c: Context, name: string): string {
  return c.req.param(name) ?? "";
}

export function positiveVersion(value: string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new RoutingValidationError(
      "invalid_rule_version",
      "Rule version must be a positive integer",
    );
  }
  return version;
}
