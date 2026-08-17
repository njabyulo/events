import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

function configuredToken(): string {
  return process.env.API_AUTH_TOKEN?.trim() ?? "";
}

function matchesToken(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const requireApiToken = createMiddleware(async (c, next) => {
  const expected = configuredToken();
  if (!expected) {
    return c.json({
      error: {
        code: "authentication_not_configured",
        message: "API_AUTH_TOKEN must be configured",
      },
    }, 503);
  }

  const authorization = c.req.header("Authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!candidate || !matchesToken(candidate, expected)) {
    c.header("WWW-Authenticate", "Bearer");
    return c.json({
      error: { code: "unauthorized", message: "A valid bearer token is required" },
    }, 401);
  }

  await next();
});
