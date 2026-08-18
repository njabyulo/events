import type { MiddlewareHandler } from "hono";
import { webhookAdapterFor } from "./webhook.adapters.js";
import { resolveWebhookSource, type WebhookSource } from "./webhook.config.js";
import type {
  VerifiedWebhookRequest,
  WebhookAdapter,
  WebhookRequest,
} from "./webhook.types.js";

export type WebhookEnvironment = {
  Variables: {
    webhookAdapter: WebhookAdapter;
    webhookRequest: VerifiedWebhookRequest;
    webhookSource: WebhookSource;
  };
};

export const verifyWebhook: MiddlewareHandler<WebhookEnvironment> = async (c, next) => {
  const source = resolveWebhookSource(c.req.param("sourceKey") ?? "");
  const adapter = webhookAdapterFor(source.provider);
  const receivedAt = new Date();
  const rawBody = new Uint8Array(await c.req.arrayBuffer());
  const verifiedRequest: VerifiedWebhookRequest = {
    headers: c.req.raw.headers,
    rawBody,
    receivedAt,
  };
  const request: WebhookRequest = {
    ...verifiedRequest,
    secret: source.secret,
  };

  await adapter.verify(request);

  c.set("webhookAdapter", adapter);
  c.set("webhookRequest", verifiedRequest);
  c.set("webhookSource", source);

  await next();
};
