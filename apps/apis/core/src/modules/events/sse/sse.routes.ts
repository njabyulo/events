import { Hono } from "hono";
import { streamEventsHandler } from "./sse.handler.js";

export const sseRouter = new Hono();

sseRouter.get("/", streamEventsHandler);
sseRouter.get("/:streamKey", streamEventsHandler);
