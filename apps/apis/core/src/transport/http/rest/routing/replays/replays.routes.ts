import { Hono } from "hono";
import { replaysHandlers } from "../../../../../modules/routing/routing.module.js";
import { jsonObject, pathParam } from "../../../request.js";

export const replaysRouter = new Hono();

replaysRouter.get("/", async (c) => c.json({ data: await replaysHandlers.list() }));
replaysRouter.post("/", async (c) => c.json({
  data: await replaysHandlers.create(await jsonObject(c)),
}, 201));
replaysRouter.get("/:id", async (c) => c.json({
  data: await replaysHandlers.get(pathParam(c, "id")),
}));
