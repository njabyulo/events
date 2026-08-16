import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { WebhookError } from "../modules/events/webhooks/webhook.types.js";
import type { AppEnvironment } from "./app.types.js";

function errorBody(code: string, message: string, requestId: string) {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}

export const apiErrorHandler: ErrorHandler<AppEnvironment> = (error, c) => {
  const requestId = c.get("requestId");

  if (error instanceof WebhookError) {
    return c.json(errorBody(error.code, error.message, requestId), error.status);
  }

  if (error instanceof HTTPException) {
    return c.json(errorBody("http_error", error.message, requestId), error.status);
  }

  console.error("Unhandled API error", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    error,
  });

  return c.json(
    errorBody("internal_server_error", "An unexpected error occurred", requestId),
    500,
  );
};

export const apiNotFoundHandler: NotFoundHandler<AppEnvironment> = (c) => c.json(
  errorBody("route_not_found", "Route does not exist", c.get("requestId")),
  404,
);
