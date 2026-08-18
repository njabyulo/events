import { Hono } from "hono";
import { rulesHandlers } from "../../../../../modules/routing/routing.module.js";
import { jsonObject, pathParam } from "../../../request.js";

export const rulesRouter = new Hono();

rulesRouter.get("/", async (c) => c.json({ data: await rulesHandlers.list() }));
rulesRouter.post("/", async (c) => c.json({
  data: await rulesHandlers.create(await jsonObject(c)),
}, 201));
rulesRouter.get("/:id/versions", async (c) => c.json({
  data: await rulesHandlers.listVersions(pathParam(c, "id")),
}));
rulesRouter.get("/:id/versions/:version", async (c) => c.json({
  data: await rulesHandlers.getVersion(
    pathParam(c, "id"),
    pathParam(c, "version"),
  ),
}));
rulesRouter.put("/:id/targets/:targetId", async (c) => {
  await rulesHandlers.attachTarget(pathParam(c, "id"), pathParam(c, "targetId"));
  return c.body(null, 204);
});
rulesRouter.delete("/:id/targets/:targetId", async (c) => {
  await rulesHandlers.detachTarget(pathParam(c, "id"), pathParam(c, "targetId"));
  return c.body(null, 204);
});
rulesRouter.get("/:id", async (c) => c.json({
  data: await rulesHandlers.get(pathParam(c, "id")),
}));
rulesRouter.patch("/:id", async (c) => c.json({
  data: await rulesHandlers.update(pathParam(c, "id"), await jsonObject(c)),
}));
rulesRouter.delete("/:id", async (c) => {
  await rulesHandlers.delete(pathParam(c, "id"));
  return c.body(null, 204);
});
