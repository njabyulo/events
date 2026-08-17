import { Hono } from "hono";
import { afterEach, describe, expect, test } from "vitest";
import { requireApiToken } from "../../../src/middleware/auth.middleware.js";

const originalToken = process.env.API_AUTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.API_AUTH_TOKEN;
  else process.env.API_AUTH_TOKEN = originalToken;
});

function app() {
  const app = new Hono();
  app.use("*", requireApiToken);
  app.get("/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("requireApiToken", () => {
  test("fails closed when authentication is not configured", async () => {
    delete process.env.API_AUTH_TOKEN;
    const response = await app().request("/protected");
    expect(response.status).toBe(503);
  });

  test("rejects a wrong token and accepts the configured bearer token", async () => {
    process.env.API_AUTH_TOKEN = "stage-one-secret";
    const application = app();

    const rejected = await application.request("/protected", {
      headers: { Authorization: "Bearer wrong" },
    });
    const accepted = await application.request("/protected", {
      headers: { Authorization: "Bearer stage-one-secret" },
    });

    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(accepted.status).toBe(200);
  });
});
