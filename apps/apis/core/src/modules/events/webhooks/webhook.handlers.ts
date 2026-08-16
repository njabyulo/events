import type { Context } from "hono";
import { eventsService } from "../events.dependencies.js";
import type { WebhookEnvironment } from "./webhook.middleware.js";

export const postWebhookHandler = async (c: Context<WebhookEnvironment>) => {
  const adapter = c.get("webhookAdapter");
  const request = c.get("webhookRequest");
  const source = c.get("webhookSource");
  const normalized = await adapter.normalize(request);
  const result = await eventsService.ingestEvent({
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
};
