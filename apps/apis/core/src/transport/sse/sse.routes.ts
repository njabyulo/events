import { Hono } from "hono";
import { requireApiToken } from "../http/middleware/auth.middleware.js";
import { streamEvents } from "./sse.transport.js";

export const sseRouter = new Hono();

sseRouter.use("*", requireApiToken);
sseRouter.get("/", streamEvents);
sseRouter.get("/:streamKey", streamEvents);
