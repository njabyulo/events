import { Hono } from "hono";
import {
  getEventHandler,
  getEventsHandler,
  postEventHandler,
} from "./core.handlers.js";

export const coreRouter = new Hono();

coreRouter.get("/", getEventsHandler);
coreRouter.post("/", postEventHandler);
coreRouter.get("/:id", getEventHandler);
