import { afterEach, describe, expect, test } from "vitest";
import { app } from "../../../src/transport/http/index.js";

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
});
