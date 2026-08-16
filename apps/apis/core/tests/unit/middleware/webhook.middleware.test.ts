import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, expect, test } from "vitest";
import type { AppEnvironment } from "../../../src/middleware/app.types.js";
import {
  apiErrorHandler,
  apiNotFoundHandler,
} from "../../../src/middleware/error.handlers.js";
import { hmacSha256 } from "../../../src/modules/events/webhooks/hmac.js";
import {
  verifyWebhook,
  type WebhookEnvironment,
} from "../../../src/modules/events/webhooks/webhook.middleware.js";

const previousGithubSecret = process.env.GITHUB_WEBHOOK_SECRET;

afterEach(() => {
  if (previousGithubSecret === undefined) {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  } else {
    process.env.GITHUB_WEBHOOK_SECRET = previousGithubSecret;
  }
});

function testApp() {
  const app = new Hono<AppEnvironment & WebhookEnvironment>();
  app.use("*", requestId());
  app.post("/:sourceKey", verifyWebhook, (c) => c.json({
    provider: c.get("webhookAdapter").provider,
    source: c.get("webhookSource").source,
    body: Buffer.from(c.get("webhookRequest").rawBody).toString("utf8"),
  }));
  app.notFound(apiNotFoundHandler);
  app.onError(apiErrorHandler);
  return app;
}

test("verified webhook middleware exposes authenticated request context", async () => {
  const secret = "middleware-test-secret";
  const body = JSON.stringify({ action: "deleted" });
  const rawBody = new TextEncoder().encode(body);
  process.env.GITHUB_WEBHOOK_SECRET = secret;

  const response = await testApp().request("/github", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": hmacSha256(secret, rawBody),
    },
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    provider: "github",
    source: "github",
    body,
  });
});

test("central error handler returns signature errors with request ID", async () => {
  process.env.GITHUB_WEBHOOK_SECRET = "middleware-test-secret";

  const response = await testApp().request("/github", {
    method: "POST",
    body: "{}",
    headers: {
      "x-request-id": "request-test-1",
      "x-hub-signature-256": "sha256=invalid",
    },
  });

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "invalid_signature",
      message: "Webhook signature is invalid",
      requestId: "request-test-1",
    },
  });
});

test("not-found handler returns the shared JSON error shape", async () => {
  const response = await testApp().request("/missing", {
    headers: { "x-request-id": "request-test-2" },
  });

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "route_not_found",
      message: "Route does not exist",
      requestId: "request-test-2",
    },
  });
});
