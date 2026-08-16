import type { Context } from "hono";
import { asJsonObject } from "../webhooks/webhook.types.js";
import { eventsService } from "../events.dependencies.js";

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function badRequest(c: Context, code: string, message: string) {
  return c.json({ error: { code, message } }, 400);
}

export const getEventsHandler = async (c: Context) => {
  const events = await eventsService.getEvents();
  return c.json({ data: events });
};

export const getEventHandler = async (c: Context) => {
  const id = c.req.param("id") ?? "";
  const event = await eventsService.getEventById(id);

  if (!event) {
    return c.json({ error: { code: "event_not_found", message: "Event does not exist" } }, 404);
  }

  return c.json({ data: event });
};

export const postEventHandler = async (c: Context) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, "invalid_payload", "Body must be a JSON object");
  }

  const payload = asJsonObject(body);
  if (!payload) {
    return badRequest(c, "invalid_payload", "Body must be a JSON object");
  }

  const source = optionalString(payload.source);
  const sourceEventId = optionalString(payload.sourceEventId);
  const type = optionalString(payload.type);
  if (!source || !sourceEventId || !type) {
    return badRequest(c, "missing_required_fields", "source, sourceEventId and type are required");
  }

  let occurredAt = new Date().toISOString();
  if (payload.occurredAt !== undefined) {
    const parsed = typeof payload.occurredAt === "string" ? new Date(payload.occurredAt) : new Date(NaN);
    if (Number.isNaN(parsed.getTime())) {
      return badRequest(c, "invalid_occurred_at", "occurredAt must be a valid timestamp");
    }
    occurredAt = parsed.toISOString();
  }

  const result = await eventsService.ingestEvent({
    source,
    sourceEventId,
    type,
    subject: optionalString(payload.subject) ?? null,
    actor: optionalString(payload.actor) ?? null,
    summary: optionalString(payload.summary) ?? null,
    occurredAt,
    detail: asJsonObject(payload.detail) ?? {},
    attributes: asJsonObject(payload.attributes) ?? {},
  });

  return c.json({
    data: {
      eventId: result.id,
      duplicate: !result.inserted,
    },
  }, result.inserted ? 202 : 200);
};
