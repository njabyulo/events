import { Hono } from "hono";
import { requireApiToken } from "../../../middleware/auth.middleware.js";
import { streamEventsHandler } from "./sse.handler.js";

export const sseRouter = new Hono();

sseRouter.use("*", requireApiToken);
sseRouter.get("/", streamEventsHandler);
sseRouter.get("/:streamKey", streamEventsHandler);
