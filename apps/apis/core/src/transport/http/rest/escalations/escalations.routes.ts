import { Hono } from "hono";
import { escalationsHandlers } from "../../../../modules/escalations/escalations.module.js";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import { jsonObject, pathParam } from "../../request.js";

export const escalationsRouter = new Hono();

escalationsRouter.use("*", requireApiToken);
escalationsRouter.get("/", async (c) => c.json({
  data: await escalationsHandlers.list(c.req.query("limit"), c.req.query("beforeId")),
}));
escalationsRouter.get("/:id/attempts", async (c) => c.json({
  data: await escalationsHandlers.listAttempts(pathParam(c, "id")),
}));
escalationsRouter.post("/:id/dismiss", async (c) => {
  await escalationsHandlers.dismiss(pathParam(c, "id"), await jsonObject(c));
  return c.body(null, 204);
});
escalationsRouter.post("/:id/retry", async (c) => {
  await escalationsHandlers.retry(pathParam(c, "id"), await jsonObject(c));
  return c.body(null, 204);
});
