import type { Context } from "hono";
import { targetsService } from "../routing.dependencies.js";
import { jsonObject, pathParam } from "../routing.http.js";

export const listTargetsHandler = async (c: Context) => c.json({
  data: await targetsService.listTargets(),
});

export const getTargetHandler = async (c: Context) => c.json({
  data: await targetsService.getTarget(pathParam(c, "id")),
});

export const createTargetHandler = async (c: Context) => {
  const body = await jsonObject(c);
  const target = await targetsService.createTarget({
    name: body.name,
    kind: body.kind,
    config: body.config,
    enabled: body.enabled,
  });
  return c.json({ data: target }, 201);
};

export const updateTargetHandler = async (c: Context) => {
  const body = await jsonObject(c);
  const target = await targetsService.updateTarget(pathParam(c, "id"), {
    name: body.name,
    kind: body.kind,
    config: body.config,
    enabled: body.enabled,
  });
  return c.json({ data: target });
};

export const deleteTargetHandler = async (c: Context) => {
  await targetsService.deleteTarget(pathParam(c, "id"));
  return c.body(null, 204);
};

export const enableTargetHandler = async (c: Context) => c.json({
  data: await targetsService.enableTarget(pathParam(c, "id")),
});

export const disableTargetHandler = async (c: Context) => c.json({
  data: await targetsService.disableTarget(pathParam(c, "id")),
});

export const testTargetHandler = async (c: Context) => {
  const body = await jsonObject(c);
  return c.json({
    data: await targetsService.testTarget(
      pathParam(c, "id"),
      body.actor,
      body.reason,
    ),
  }, 202);
};
