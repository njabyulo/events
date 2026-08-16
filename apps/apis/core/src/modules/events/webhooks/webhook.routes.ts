import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { maxBodyBytes } from "./webhook.config.js";
import { postWebhookHandler } from "./webhook.handlers.js";
import { verifyWebhook, type WebhookEnvironment } from "./webhook.middleware.js";
import { WebhookError } from "./webhook.types.js";

export const webhooksRouter = new Hono<WebhookEnvironment>();

webhooksRouter.post(
  "/:sourceKey",
  bodyLimit({
    maxSize: maxBodyBytes(),
    onError: () => {
      throw new WebhookError(413, "payload_too_large", "Webhook payload is too large");
    },
  }),
  verifyWebhook,
  postWebhookHandler,
);
