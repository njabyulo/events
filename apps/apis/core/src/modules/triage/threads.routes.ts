import { Hono } from "hono";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import {
  ackThreadHandler,
  getThreadHandler,
  listThreadsHandler,
  snoozeThreadHandler,
} from "./threads.handlers.js";

export const threadsRouter = new Hono();

threadsRouter.use("*", requireApiToken);
threadsRouter.get("/", listThreadsHandler);
threadsRouter.post("/:id/ack", ackThreadHandler);
threadsRouter.post("/:id/snooze", snoozeThreadHandler);
threadsRouter.get("/:id", getThreadHandler);
