import { Hono } from "hono";
import { gmailRouter } from "./gmail/gmail.routes.js";
import { webhooksRouter } from "../../webhooks/webhook.routes.js";

export const sourcesRouter = new Hono();

sourcesRouter.route("/gmail", gmailRouter);
sourcesRouter.route("/", webhooksRouter);
