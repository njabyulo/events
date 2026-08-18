import { Hono } from "hono";
import { triageHandlers } from "../../../../modules/triage/triage.module.js";
import { requireApiToken } from "../../middleware/auth.middleware.js";

export const triageRouter = new Hono();

triageRouter.use("*", requireApiToken);
triageRouter.get("/items", async (c) => c.json({
  data: await triageHandlers.listItems(
    c.req.query("streamKey"),
    c.req.query("afterId"),
    c.req.query("limit"),
  ),
}));
