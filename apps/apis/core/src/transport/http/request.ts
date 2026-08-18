import type { Context } from "hono";
import { HttpInputError } from "./http.errors.js";

export async function jsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpInputError("Body must be a JSON object");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpInputError("Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function pathParam(c: Context, name: string): string {
  return c.req.param(name) ?? "";
}
