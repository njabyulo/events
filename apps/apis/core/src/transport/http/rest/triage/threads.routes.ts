import { Hono } from "hono";
import { threadsHandlers } from "../../../../modules/triage/threads.module.js";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import { jsonObject, pathParam } from "../../request.js";

export const threadsRouter = new Hono();

threadsRouter.use("*", requireApiToken);
threadsRouter.get("/", async (c) => c.json({
  data: await threadsHandlers.list(c.req.query("streamKey")),
}));
threadsRouter.post("/:id/ack", async (c) => {
  await threadsHandlers.ack(pathParam(c, "id"), await jsonObject(c));
  return c.body(null, 204);
});
threadsRouter.post("/:id/snooze", async (c) => {
  await threadsHandlers.snooze(pathParam(c, "id"), await jsonObject(c));
  return c.body(null, 204);
});
threadsRouter.post("/:id/replies", async (c) => {
  const result = await threadsHandlers.reply(
    pathParam(c, "id"),
    await jsonObject(c),
  );
  return c.json({
    data: { eventId: result.id, duplicate: !result.inserted },
  }, result.inserted ? 202 : 200);
});
threadsRouter.get("/:id", async (c) => c.json({
  data: await threadsHandlers.get(pathParam(c, "id")),
}));
