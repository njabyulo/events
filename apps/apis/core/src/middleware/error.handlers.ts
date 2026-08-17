import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  EventStoreUnavailableError,
  EventValidationError,
} from "core/events";
import { GmailMessageError } from "core/gmail";
import {
  RoutingConflictError,
  RoutingNotFoundError,
  RoutingStoreUnavailableError,
  RoutingValidationError,
} from "core/routing";
import { GmailSourceError } from "../modules/events/sources/gmail/gmail.config.js";
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

  if (error instanceof EventValidationError) {
    return c.json(errorBody(error.code, error.message, requestId), 400);
  }

  if (error instanceof RoutingValidationError) {
    return c.json(errorBody(error.code, error.message, requestId), 400);
  }

  if (error instanceof RoutingNotFoundError) {
    return c.json(errorBody(error.code, error.message, requestId), 404);
  }

  if (error instanceof RoutingConflictError) {
    return c.json(errorBody(error.code, error.message, requestId), 409);
  }

  if (error instanceof RoutingStoreUnavailableError) {
    console.error("Routing store unavailable", { requestId, cause: error.cause });
    return c.json(errorBody("routing_store_unavailable", error.message, requestId), 503);
  }

  if (error instanceof EventStoreUnavailableError) {
    console.error("Event store unavailable", { requestId, cause: error.cause });
    return c.json(errorBody("event_store_unavailable", error.message, requestId), 503);
  }

  if (error instanceof GmailSourceError) {
    return c.json(errorBody(error.code, error.message, requestId), error.status);
  }

  if (error instanceof GmailMessageError) {
    return c.json(errorBody("invalid_gmail_message", error.message, requestId), 503);
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
