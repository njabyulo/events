import { Hono } from "hono";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import {
  ackTriageItemHandler,
  listTriageItemsHandler,
  snoozeTriageItemHandler,
} from "./triage.handlers.js";

export const triageRouter = new Hono();

triageRouter.use("*", requireApiToken);
triageRouter.get("/items", listTriageItemsHandler);
triageRouter.post("/items/:id/ack", ackTriageItemHandler);
triageRouter.post("/items/:id/snooze", snoozeTriageItemHandler);
