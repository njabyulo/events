import type { Context } from "hono";
import { jsonObject, pathParam } from "../routing/routing.http.js";
import { triageConfig } from "./triage.config.js";
import { triageService } from "./triage.dependencies.js";

export const listTriageItemsHandler = async (c: Context) => c.json({
  data: await triageService.listItems(c.req.query("streamKey") || triageConfig.streamKey),
});

export const ackTriageItemHandler = async (c: Context) => {
  const body = await jsonObject(c);
  await triageService.ack(pathParam(c, "id"), body.receiptHandle, body.actor);
  return c.body(null, 204);
};

export const snoozeTriageItemHandler = async (c: Context) => {
  const body = await jsonObject(c);
  await triageService.snooze(
    pathParam(c, "id"),
    body.receiptHandle,
    body.actor,
    body.delaySeconds,
  );
  return c.body(null, 204);
};
