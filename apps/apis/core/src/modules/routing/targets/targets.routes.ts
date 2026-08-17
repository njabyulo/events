import { Hono } from "hono";
import {
  createTargetHandler,
  deleteTargetHandler,
  disableTargetHandler,
  enableTargetHandler,
  getTargetHandler,
  listTargetsHandler,
  testTargetHandler,
  updateTargetHandler,
} from "./targets.handlers.js";

export const targetsRouter = new Hono();

targetsRouter.get("/", listTargetsHandler);
targetsRouter.post("/", createTargetHandler);
targetsRouter.post("/:id/enable", enableTargetHandler);
targetsRouter.post("/:id/disable", disableTargetHandler);
targetsRouter.post("/:id/test", testTargetHandler);
targetsRouter.get("/:id", getTargetHandler);
targetsRouter.patch("/:id", updateTargetHandler);
targetsRouter.delete("/:id", deleteTargetHandler);
