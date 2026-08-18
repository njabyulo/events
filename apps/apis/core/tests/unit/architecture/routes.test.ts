import { afterEach, describe, expect, test, vi } from "vitest";
import { app, createApp } from "../../../src/transport/http/index.js";

const githubSecret = process.env.GITHUB_WEBHOOK_SECRET;

afterEach(() => {
  if (githubSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
  else process.env.GITHUB_WEBHOOK_SECRET = githubSecret;
});

describe("HTTP route composition", () => {
  test("mounts provider webhooks under the sources transport", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "route-test-secret";

    const response = await app.request("/sources/github/webhook", {
      method: "POST",
      body: "{}",
      headers: { "x-hub-signature-256": "sha256=invalid" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_signature" },
    });
  });

  test("does not retain the removed events SSE compatibility route", async () => {
    const response = await app.request("/events/sse");
    expect(response.status).toBe(404);
  });

  test("separates process liveness from database and schema readiness", async () => {
    const readiness = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("schema is missing"));
    const testApp = createApp({ readiness });

    expect((await testApp.request("/health/live")).status).toBe(200);
    await expect((await testApp.request("/health/ready")).json())
      .resolves.toEqual({ status: "ready" });
    const unavailable = await testApp.request("/health/ready");
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ status: "not_ready" });
  });
});
