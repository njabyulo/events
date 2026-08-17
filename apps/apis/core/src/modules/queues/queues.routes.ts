import { Hono } from "hono";
import { requireApiToken } from "../../middleware/auth.middleware.js";
import {
  ackMessageHandler,
  createQueueHandler,
  deleteQueueHandler,
  extendVisibilityHandler,
  flushDigestHandler,
  getQueueHandler,
  getQueueStatsHandler,
  listAttemptsHandler,
  listQueuesHandler,
  nackMessageHandler,
  receiveMessagesHandler,
  sendMessageHandler,
  snoozeMessageHandler,
  updateQueueHandler,
} from "./queues.handlers.js";

export const queuesRouter = new Hono();

queuesRouter.use("*", requireApiToken);
queuesRouter.get("/", listQueuesHandler);
queuesRouter.post("/", createQueueHandler);
queuesRouter.post("/:id/messages", sendMessageHandler);
queuesRouter.post("/:id/messages/receive", receiveMessagesHandler);
queuesRouter.post("/:id/messages/:messageId/ack", ackMessageHandler);
queuesRouter.post("/:id/messages/:messageId/nack", nackMessageHandler);
queuesRouter.post("/:id/messages/:messageId/snooze", snoozeMessageHandler);
queuesRouter.post("/:id/messages/:messageId/visibility", extendVisibilityHandler);
queuesRouter.get("/:id/messages/:messageId/attempts", listAttemptsHandler);
queuesRouter.get("/:id/stats", getQueueStatsHandler);
queuesRouter.post("/:id/flush", flushDigestHandler);
queuesRouter.get("/:id", getQueueHandler);
queuesRouter.patch("/:id", updateQueueHandler);
queuesRouter.delete("/:id", deleteQueueHandler);
