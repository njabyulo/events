import { Hono } from "hono";
import { coreRouter } from "./core/core.routes.js";
import { sseRouter } from "./sse/sse.routes.js";

export const eventsRouter = new Hono();

eventsRouter.route("/sse", sseRouter);
eventsRouter.route("/", coreRouter);
