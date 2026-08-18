import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { EventValidationError, type EventEnvelope } from "core/events";
import { eventsHandlers } from "../../../../modules/events/events.module.js";
import { maxEventBodyBytes } from "./events.config.js";

export const eventsRouter = new Hono();

eventsRouter.get("/", async (c) => c.json({
  data: await eventsHandlers.list({
    limit: c.req.query("limit"),
    beforeOccurredAt: c.req.query("beforeOccurredAt"),
    beforeId: c.req.query("beforeId"),
  }),
}));
eventsRouter.post(
  "/",
  bodyLimit({
    maxSize: maxEventBodyBytes(),
    onError: () => {
      throw new HTTPException(413, { message: "Event payload is too large" });
    },
  }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new EventValidationError("invalid_payload", "Body must be a JSON object");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new EventValidationError("invalid_payload", "Body must be a JSON object");
    }
    const result = await eventsHandlers.ingest(body as EventEnvelope);
    return c.json({
      data: {
        eventId: result.id,
        sourceEventId: result.sourceEventId,
        duplicate: !result.inserted,
      },
    }, result.inserted ? 202 : 200);
  },
);
eventsRouter.get("/:id/routes", async (c) => {
  const routing = await eventsHandlers.getRouting(c.req.param("id"));
  if (!routing) {
    return c.json({
      error: { code: "event_not_found", message: "Event does not exist" },
    }, 404);
  }
  return c.json({ data: routing });
});
eventsRouter.get("/:id", async (c) => {
  const event = await eventsHandlers.get(c.req.param("id"));
  if (!event) {
    return c.json({
      error: { code: "event_not_found", message: "Event does not exist" },
    }, 404);
  }
  return c.json({ data: event });
});
