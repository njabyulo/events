import { Hono } from "hono";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import { listTriageItemsHandler } from "./triage.handlers.js";

export const triageRouter = new Hono();

triageRouter.use("*", requireApiToken);
triageRouter.get("/items", listTriageItemsHandler);
