import { Hono } from "hono";
import {
  attachRuleTargetHandler,
  createRuleHandler,
  deleteRuleHandler,
  detachRuleTargetHandler,
  getRuleHandler,
  getRuleVersionHandler,
  listRulesHandler,
  listRuleVersionsHandler,
  updateRuleHandler,
} from "./rules.handlers.js";

export const rulesRouter = new Hono();

rulesRouter.get("/", listRulesHandler);
rulesRouter.post("/", createRuleHandler);
rulesRouter.get("/:id/versions", listRuleVersionsHandler);
rulesRouter.get("/:id/versions/:version", getRuleVersionHandler);
rulesRouter.put("/:id/targets/:targetId", attachRuleTargetHandler);
rulesRouter.delete("/:id/targets/:targetId", detachRuleTargetHandler);
rulesRouter.get("/:id", getRuleHandler);
rulesRouter.patch("/:id", updateRuleHandler);
rulesRouter.delete("/:id", deleteRuleHandler);
