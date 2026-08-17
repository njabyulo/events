import { Hono } from "hono";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnvironment } from "../middleware/app.types.js";
import { apiErrorHandler, apiNotFoundHandler } from "../middleware/error.handlers.js";
import { eventsRouter } from "../modules/events/events.routes.js";
import { sseRouter } from "../modules/events/sse/sse.routes.js";
import { sourcesRouter } from "../modules/events/sources/sources.routes.js";
import { queuesRouter } from "../modules/queues/queues.routes.js";
import { replaysRouter } from "../modules/routing/replays/replays.routes.js";
import { rulesRouter } from "../modules/routing/rules/rules.routes.js";
import { targetsRouter } from "../modules/routing/targets/targets.routes.js";
import { triageRouter } from "../modules/triage/triage.routes.js";
import { dashboardHtml } from "../modules/triage/dashboard.page.js";

export const app = new Hono<AppEnvironment>();

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());

app.get("/", (c) => c.text("Hello Hono!"));
app.get("/dashboard", (c) => c.html(dashboardHtml));

app.route("/events", eventsRouter);
app.route("/streams", sseRouter);
app.route("/sources", sourcesRouter);
app.route("/rules", rulesRouter);
app.route("/targets", targetsRouter);
app.route("/queues", queuesRouter);
app.route("/replays", replaysRouter);
app.route("/triage", triageRouter);

app.notFound(apiNotFoundHandler);
app.onError(apiErrorHandler);
