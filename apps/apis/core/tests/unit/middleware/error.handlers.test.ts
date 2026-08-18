import { AgentNotFoundError, AgentValidationError } from "core/agents";
import {
  EscalationConflictError,
  EscalationNotFoundError,
  EscalationValidationError,
} from "core/escalations";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { describe, expect, test } from "vitest";
import type { AppEnvironment } from "../../../src/transport/http/middleware/app.types.js";
import { apiErrorHandler } from "../../../src/transport/http/middleware/error.handlers.js";
import { jsonObject } from "../../../src/transport/http/request.js";

function application(error: Error) {
  const app = new Hono<AppEnvironment>();
  app.use("*", requestId());
  app.post("/error", async (c) => {
    await jsonObject(c);
    throw error;
  });
  app.onError(apiErrorHandler);
  return app;
}

describe("API domain error mapping", () => {
  test.each([
    [new AgentValidationError("message is required"), 400, "invalid_agent_input"],
    [new AgentNotFoundError(), 404, "agent_thread_not_found"],
    [new EscalationValidationError("actor is required"), 400, "invalid_escalation_action"],
    [new EscalationNotFoundError(), 404, "escalation_not_found"],
    [new EscalationConflictError(), 409, "escalation_conflict"],
  ])("maps %s to an intentional HTTP response", async (error, status, code) => {
    const response = await application(error).request("/error", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  test("maps malformed generic JSON without pretending it is a routing error", async () => {
    const response = await application(new Error("unreachable")).request("/error", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_payload" },
    });
  });
});
