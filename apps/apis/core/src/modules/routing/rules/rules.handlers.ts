import type { Context } from "hono";
import { rulesService } from "../routing.dependencies.js";
import { jsonObject, pathParam, positiveVersion } from "../routing.http.js";

export const listRulesHandler = async (c: Context) => c.json({
  data: await rulesService.listRules(),
});

export const getRuleHandler = async (c: Context) => c.json({
  data: await rulesService.getRule(pathParam(c, "id")),
});

export const listRuleVersionsHandler = async (c: Context) => c.json({
  data: await rulesService.listRuleVersions(pathParam(c, "id")),
});

export const getRuleVersionHandler = async (c: Context) => c.json({
  data: await rulesService.getRuleVersion(
    pathParam(c, "id"),
    positiveVersion(pathParam(c, "version")),
  ),
});

export const createRuleHandler = async (c: Context) => {
  const body = await jsonObject(c);
  const rule = await rulesService.createRule({
    name: body.name,
    pattern: body.pattern,
    priority: body.priority,
    enabled: body.enabled,
  });
  return c.json({ data: rule }, 201);
};

export const updateRuleHandler = async (c: Context) => {
  const body = await jsonObject(c);
  const rule = await rulesService.updateRule(pathParam(c, "id"), {
    name: body.name,
    pattern: body.pattern,
    priority: body.priority,
    enabled: body.enabled,
  });
  return c.json({ data: rule });
};

export const deleteRuleHandler = async (c: Context) => {
  await rulesService.deleteRule(pathParam(c, "id"));
  return c.body(null, 204);
};

export const attachRuleTargetHandler = async (c: Context) => {
  await rulesService.attachTarget(pathParam(c, "id"), pathParam(c, "targetId"));
  return c.body(null, 204);
};

export const detachRuleTargetHandler = async (c: Context) => {
  await rulesService.detachTarget(pathParam(c, "id"), pathParam(c, "targetId"));
  return c.body(null, 204);
};
