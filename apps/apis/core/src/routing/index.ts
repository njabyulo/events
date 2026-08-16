import { Hono } from "hono";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnvironment } from "../middleware/app.types.js";
import { apiErrorHandler, apiNotFoundHandler } from "../middleware/error.handlers.js";
import { eventsRouter } from "../modules/events/events.routes.js";

export const app = new Hono<AppEnvironment>();

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());

app.get("/", (c) => c.text("Hello Hono!"));

app.route("/events", eventsRouter);

app.notFound(apiNotFoundHandler);
app.onError(apiErrorHandler);
