import type { Context } from "hono";
import { jsonObject, pathParam } from "../routing/routing.http.js";
import { queuesService } from "./queues.dependencies.js";

export const listQueuesHandler = async (c: Context) => c.json({
  data: await queuesService.listQueues(),
});

export const getQueueHandler = async (c: Context) => c.json({
  data: await queuesService.getQueue(pathParam(c, "id")),
});

export const createQueueHandler = async (c: Context) => c.json({
  data: await queuesService.createQueue(await jsonObject(c)),
}, 201);

export const updateQueueHandler = async (c: Context) => c.json({
  data: await queuesService.updateQueue(pathParam(c, "id"), await jsonObject(c)),
});

export const deleteQueueHandler = async (c: Context) => {
  await queuesService.deleteQueue(pathParam(c, "id"));
  return c.body(null, 204);
};

export const sendMessageHandler = async (c: Context) => c.json({
  data: await queuesService.sendMessage(pathParam(c, "id"), await jsonObject(c)),
}, 201);

export const receiveMessagesHandler = async (c: Context) => c.json({
  data: await queuesService.receiveMessages(pathParam(c, "id"), await jsonObject(c)),
});

export const ackMessageHandler = async (c: Context) => {
  const body = await jsonObject(c);
  await queuesService.ackMessage(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    body.receiptHandle,
    body.consumerName,
  );
  return c.body(null, 204);
};

export const snoozeMessageHandler = async (c: Context) => {
  await queuesService.snoozeMessage(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    await jsonObject(c),
  );
  return c.body(null, 204);
};

export const extendVisibilityHandler = async (c: Context) => {
  await queuesService.extendMessageVisibility(
    pathParam(c, "id"),
    pathParam(c, "messageId"),
    await jsonObject(c),
  );
  return c.body(null, 204);
};

export const listAttemptsHandler = async (c: Context) => c.json({
  data: await queuesService.listAttempts(pathParam(c, "messageId")),
});

export const getQueueStatsHandler = async (c: Context) => c.json({
  data: await queuesService.getStats(pathParam(c, "id")),
});
