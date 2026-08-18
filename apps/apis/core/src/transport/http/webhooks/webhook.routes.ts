import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eventsHandlers } from "../../../modules/events/events.module.js";
import { maxBodyBytes } from "./webhook.config.js";
import { verifyWebhook, type WebhookEnvironment } from "./webhook.middleware.js";
import { WebhookError } from "./webhook.types.js";

export const webhooksRouter = new Hono<WebhookEnvironment>();

webhooksRouter.post(
  "/:sourceKey/webhook",
  bodyLimit({
    maxSize: maxBodyBytes(),
    onError: () => {
      throw new WebhookError(413, "payload_too_large", "Webhook payload is too large");
    },
  }),
  verifyWebhook,
  async (c) => {
    const source = c.get("webhookSource");
    const normalized = await c.get("webhookAdapter").normalize(c.get("webhookRequest"));
    const result = await eventsHandlers.ingest({
      source: source.source,
      sourceEventId: normalized.sourceEventId,
      type: normalized.type,
      actor: normalized.actor,
      subject: normalized.subject,
      summary: normalized.summary,
      occurredAt: normalized.occurredAt,
      correlationId: normalized.correlationId,
      causationEventId: normalized.causationEventId,
      traceId: normalized.traceId,
      detail: normalized.detail,
      attributes: {
        ...normalized.attributes,
        source_key: source.key,
        source_event_type: normalized.sourceEventType,
      },
      links: normalized.links,
    });
    return c.json({
      data: {
        eventId: result.id,
        sourceEventId: result.sourceEventId,
        duplicate: !result.inserted,
      },
    }, result.inserted ? 202 : 200);
  },
);
