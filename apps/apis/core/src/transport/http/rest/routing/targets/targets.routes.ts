import { Hono } from "hono";
import { targetsHandlers } from "../../../../../modules/routing/routing.module.js";
import { jsonObject, pathParam } from "../../../request.js";

export const targetsRouter = new Hono();

targetsRouter.get("/", async (c) => c.json({ data: await targetsHandlers.list() }));
targetsRouter.post("/", async (c) => c.json({
  data: await targetsHandlers.create(await jsonObject(c)),
}, 201));
targetsRouter.post("/:id/enable", async (c) => c.json({
  data: await targetsHandlers.enable(pathParam(c, "id")),
}));
targetsRouter.post("/:id/disable", async (c) => c.json({
  data: await targetsHandlers.disable(pathParam(c, "id")),
}));
targetsRouter.post("/:id/test", async (c) => c.json({
  data: await targetsHandlers.test(pathParam(c, "id"), await jsonObject(c)),
}, 202));
targetsRouter.get("/:id", async (c) => c.json({
  data: await targetsHandlers.get(pathParam(c, "id")),
}));
targetsRouter.patch("/:id", async (c) => c.json({
  data: await targetsHandlers.update(pathParam(c, "id"), await jsonObject(c)),
}));
targetsRouter.delete("/:id", async (c) => {
  await targetsHandlers.delete(pathParam(c, "id"));
  return c.body(null, 204);
});
