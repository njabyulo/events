import { Hono } from "hono";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnvironment } from "./middleware/app.types.js";
import { apiErrorHandler, apiNotFoundHandler } from "./middleware/error.handlers.js";
import { eventsRouter } from "./rest/events/events.routes.js";
import { escalationsRouter } from "./rest/escalations/escalations.routes.js";
import { sourcesRouter } from "./rest/sources/sources.routes.js";
import { queuesRouter } from "./rest/queues/queues.routes.js";
import { replaysRouter } from "./rest/routing/replays/replays.routes.js";
import { rulesRouter } from "./rest/routing/rules/rules.routes.js";
import { targetsRouter } from "./rest/routing/targets/targets.routes.js";
import { triageRouter } from "./rest/triage/triage.routes.js";
import { dashboardHtml } from "./rest/triage/dashboard.page.js";
import { threadsRouter } from "./rest/triage/threads.routes.js";
import { sseRouter } from "../sse/sse.routes.js";

export const app = new Hono<AppEnvironment>();

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());

app.get("/", (c) => c.text("Hello Hono!"));
app.get("/dashboard", (c) => c.html(dashboardHtml));

app.route("/events", eventsRouter);
app.route("/escalations", escalationsRouter);
app.route("/streams", sseRouter);
app.route("/sources", sourcesRouter);
app.route("/rules", rulesRouter);
app.route("/targets", targetsRouter);
app.route("/queues", queuesRouter);
app.route("/replays", replaysRouter);
app.route("/triage", triageRouter);
app.route("/threads", threadsRouter);

app.notFound(apiNotFoundHandler);
app.onError(apiErrorHandler);
