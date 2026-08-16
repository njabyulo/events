import { Hono } from "hono";
import { pollGmailHandler } from "./gmail.handlers.js";

export const gmailRouter = new Hono();

gmailRouter.post("/poll", pollGmailHandler);
