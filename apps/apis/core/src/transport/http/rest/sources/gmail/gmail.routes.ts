import { Hono } from "hono";
import { gmailHandlers } from "../../../../../modules/gmail/gmail.module.js";

export const gmailRouter = new Hono();

gmailRouter.post("/poll", async (c) => c.json({ data: await gmailHandlers.poll() }));
