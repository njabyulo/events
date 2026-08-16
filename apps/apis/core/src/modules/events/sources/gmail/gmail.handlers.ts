import type { Context } from "hono";
import { gmailService } from "./gmail.dependencies.js";

export const pollGmailHandler = async (c: Context) => {
  const result = await gmailService().poll();
  return c.json({ data: result });
};
