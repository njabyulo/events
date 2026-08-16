import { expect, test, vi } from "vitest";
import {
  createEventsService,
  type EventsRepository,
  type StoredEvent,
} from "core/events";

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
  detail: {},
  attributes: {},
};

test("events service fetches events through its repository", async () => {
  const getEvents = vi.fn(async () => [storedEvent]);
  const eventsRepository: EventsRepository = {
    getEvents,
    getEventById: vi.fn(async () => null),
    ingestEvent: vi.fn(async () => ({ id: "1", inserted: true })),
  };
  const service = createEventsService({ eventsRepository });

  await expect(service.getEvents()).resolves.toEqual([storedEvent]);
  expect(getEvents).toHaveBeenCalledOnce();
});
