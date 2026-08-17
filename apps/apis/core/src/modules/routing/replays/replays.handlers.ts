import type { Context } from "hono";
import { replaysService } from "../routing.dependencies.js";
import { jsonObject, pathParam } from "../routing.http.js";

export const listReplaysHandler = async (c: Context) => c.json({
  data: await replaysService.listReplays(),
});

export const getReplayHandler = async (c: Context) => c.json({
  data: await replaysService.getReplay(pathParam(c, "id")),
});

export const createReplayHandler = async (c: Context) => {
  const body = await jsonObject(c);
  const replay = await replaysService.createReplay({
    requestedBy: body.requestedBy,
    reason: body.reason,
    eventFilter: body.eventFilter,
    ruleId: body.ruleId,
    ruleVersion: body.ruleVersion,
  });
  return c.json({ data: replay }, 201);
};
