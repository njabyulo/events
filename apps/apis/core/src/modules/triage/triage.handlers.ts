import type { Context } from "hono";
import { triageConfig } from "./triage.config.js";
import { triageService } from "./triage.dependencies.js";

export const listTriageItemsHandler = async (c: Context) => c.json({
  data: await triageService.listItems(c.req.query("streamKey") || triageConfig.streamKey),
});
