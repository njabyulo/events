import { Hono } from "hono";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnvironment } from "../middleware/app.types.js";
import { apiErrorHandler, apiNotFoundHandler } from "../middleware/error.handlers.js";
import { eventsRouter } from "../modules/events/events.routes.js";
import { sourcesRouter } from "../modules/events/sources/sources.routes.js";
import { replaysRouter } from "../modules/routing/replays/replays.routes.js";
import { rulesRouter } from "../modules/routing/rules/rules.routes.js";
import { queuesRouter, targetsRouter } from "../modules/routing/targets/targets.routes.js";

export const app = new Hono<AppEnvironment>();

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());

app.get("/", (c) => c.text("Hello Hono!"));

app.route("/v1/events", eventsRouter);
app.route("/v1/sources", sourcesRouter);
app.route("/v1/rules", rulesRouter);
app.route("/v1/targets", targetsRouter);
app.route("/v1/queues", queuesRouter);
app.route("/v1/replays", replaysRouter);

app.notFound(apiNotFoundHandler);
app.onError(apiErrorHandler);
