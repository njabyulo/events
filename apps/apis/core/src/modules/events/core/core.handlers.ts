import { EventValidationError, type EventEnvelope } from "core/events";
import type { Context } from "hono";
import { eventsService } from "../events.dependencies.js";
import { routerService } from "../../routing/routing.dependencies.js";

export const getEventsHandler = async (c: Context) => {
  const events = await eventsService.getEvents();
  return c.json({ data: events });
};

export const getEventHandler = async (c: Context) => {
  const id = c.req.param("id") ?? "";
  const event = await eventsService.getEventById(id);

  if (!event) {
    return c.json({
      error: { code: "event_not_found", message: "Event does not exist" },
    }, 404);
  }

  return c.json({ data: event });
};

export const getEventRoutesHandler = async (c: Context) => {
  const id = c.req.param("id") ?? "";
  const event = await eventsService.getEventById(id);
  if (!event) {
    return c.json({
      error: { code: "event_not_found", message: "Event does not exist" },
    }, 404);
  }
  return c.json({ data: await routerService.getEventRouting(id) });
};

export const postEventHandler = async (c: Context) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new EventValidationError(
      "invalid_payload",
      "Body must be a JSON object",
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new EventValidationError(
      "invalid_payload",
      "Body must be a JSON object",
    );
  }

  const result = await eventsService.ingestEvent(body as EventEnvelope);

  return c.json({
    data: {
      eventId: result.id,
      sourceEventId: result.sourceEventId,
      duplicate: !result.inserted,
    },
  }, result.inserted ? 202 : 200);
};
