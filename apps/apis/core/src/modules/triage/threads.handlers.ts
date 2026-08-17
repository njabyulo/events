import type { Context } from "hono";
import { jsonObject, pathParam } from "../routing/routing.http.js";
import { triageConfig } from "./triage.config.js";
import { threadsService } from "./triage.dependencies.js";

export const listThreadsHandler = async (c: Context) => c.json({
  data: await threadsService.listThreads(c.req.query("streamKey") || triageConfig.streamKey),
});

export const getThreadHandler = async (c: Context) => c.json({
  data: await threadsService.getThread(pathParam(c, "id")),
});

export const ackThreadHandler = async (c: Context) => {
  const body = await jsonObject(c);
  await threadsService.ack(pathParam(c, "id"), body.actor);
  return c.body(null, 204);
};

export const snoozeThreadHandler = async (c: Context) => {
  const body = await jsonObject(c);
  await threadsService.snooze(pathParam(c, "id"), body.actor, body.delaySeconds);
  return c.body(null, 204);
};
