import { expect, test, vi } from "vitest";
import {
  createEventsService,
  EventValidationError,
  type EventsRepository,
  type EventToIngest,
  type StoredEvent,
} from "../../../src/events/events.service.js";

const storedEvent: StoredEvent = {
  id: "1",
  source: "test",
  sourceEventId: "event-1",
  type: "test.created",
  subject: null,
  actor: null,
  summary: "Test event",
  occurredAt: "2026-08-16T10:00:00.000Z",
  ingestedAt: "2026-08-16T10:00:01.000Z",
  correlationId: null,
  causationEventId: null,
  traceId: null,
  detail: {},
  attributes: {},
  links: [],
};

test("events service fetches events through its repository", async () => {
  const getEvents = vi.fn(async () => [storedEvent]);
  const eventsRepository: EventsRepository = {
    getEvents,
    getEventById: vi.fn(async () => null),
    ingestEvent: vi.fn(async () => ({
      id: "1",
      sourceEventId: "event-1",
      inserted: true,
    })),
    getSourceCursor: vi.fn(async () => null),
    setSourceCursor: vi.fn(async () => undefined),
  };
  const service = createEventsService({ eventsRepository });

  await expect(service.getEvents()).resolves.toEqual([storedEvent]);
  expect(getEvents).toHaveBeenCalledOnce();
});

test("classified events retain causation to an existing source event", async () => {
  const ingestEvent = vi.fn(async (event: EventToIngest) => ({
    id: "2",
    sourceEventId: event.sourceEventId,
    inserted: true,
  }));
  const eventsRepository: EventsRepository = {
    getEvents: vi.fn(async () => []),
    getEventById: vi.fn(async () => storedEvent),
    ingestEvent,
    getSourceCursor: vi.fn(async () => null),
    setSourceCursor: vi.fn(async () => undefined),
  };
  const service = createEventsService({ eventsRepository });

  await service.ingestEvent({
    source: "classifier",
    sourceEventId: "classification-2",
    type: "notification.classified",
    occurredAt: "2026-08-16T10:01:00.000Z",
    causationEventId: "1",
    detail: { category: "career" },
  });

  expect(ingestEvent).toHaveBeenCalledWith(expect.objectContaining({
    causationEventId: "1",
  }));
});

test("rejects causation pointing at a missing event", async () => {
  const ingestEvent = vi.fn();
  const eventsRepository: EventsRepository = {
    getEvents: vi.fn(async () => []),
    getEventById: vi.fn(async () => null),
    ingestEvent,
    getSourceCursor: vi.fn(async () => null),
    setSourceCursor: vi.fn(async () => undefined),
  };
  const service = createEventsService({ eventsRepository });

  await expect(service.ingestEvent({
    source: "classifier",
    sourceEventId: "classification-404",
    type: "notification.classified",
    occurredAt: "2026-08-16T10:01:00.000Z",
    causationEventId: "404",
    detail: {},
  })).rejects.toBeInstanceOf(EventValidationError);
  expect(ingestEvent).not.toHaveBeenCalled();
});
