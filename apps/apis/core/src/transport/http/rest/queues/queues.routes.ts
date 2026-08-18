import { Hono } from "hono";
import { queuesHandlers } from "../../../../modules/queues/queues.module.js";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import { jsonObject, pathParam } from "../../request.js";

export const queuesRouter = new Hono();

queuesRouter.use("*", requireApiToken);
queuesRouter.get("/", async (c) => c.json({ data: await queuesHandlers.list() }));
queuesRouter.post("/", async (c) => c.json({
  data: await queuesHandlers.create(await jsonObject(c)),
}, 201));
queuesRouter.post("/:id/messages", async (c) => c.json({
  data: await queuesHandlers.send(pathParam(c, "id"), await jsonObject(c)),
}, 201));
queuesRouter.post("/:id/messages/receive", async (c) => c.json({
  data: await queuesHandlers.receive(pathParam(c, "id"), await jsonObject(c)),
}));
queuesRouter.post("/:id/messages/:messageId/ack", async (c) => {
  await queuesHandlers.ack(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    await jsonObject(c),
  );
  return c.body(null, 204);
});
queuesRouter.post("/:id/messages/:messageId/nack", async (c) => {
  await queuesHandlers.nack(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    await jsonObject(c),
  );
  return c.body(null, 204);
});
queuesRouter.post("/:id/messages/:messageId/snooze", async (c) => {
  await queuesHandlers.snooze(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    await jsonObject(c),
  );
  return c.body(null, 204);
});
queuesRouter.post("/:id/messages/:messageId/visibility", async (c) => {
  await queuesHandlers.extendVisibility(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    await jsonObject(c),
  );
  return c.body(null, 204);
});
queuesRouter.get("/:id/messages/:messageId/attempts", async (c) => c.json({
  data: await queuesHandlers.listAttempts(pathParam(c, "messageId")),
}));
queuesRouter.get("/:id/stats", async (c) => c.json({
  data: await queuesHandlers.stats(pathParam(c, "id")),
}));
queuesRouter.post("/:id/flush", async (c) => c.json({
  data: await queuesHandlers.flushDigest(pathParam(c, "id")),
}));
queuesRouter.get("/:id", async (c) => c.json({
  data: await queuesHandlers.get(pathParam(c, "id")),
}));
queuesRouter.patch("/:id", async (c) => c.json({
  data: await queuesHandlers.update(pathParam(c, "id"), await jsonObject(c)),
}));
queuesRouter.delete("/:id", async (c) => {
  await queuesHandlers.delete(pathParam(c, "id"));
  return c.body(null, 204);
});
