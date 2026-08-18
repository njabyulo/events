import type { EventEnvelope, EventsService } from "core/events";
import type { RouterService } from "core/routing";

type EventsPort = Pick<EventsService, "getEvents" | "getEventById" | "ingestEvent">;
type EventRoutingPort = Pick<RouterService, "getEventRouting">;

export class EventsHandlers {
  constructor(
    private readonly events: EventsPort,
    private readonly router: EventRoutingPort,
  ) {}

  list() {
    return this.events.getEvents();
  }

  get(id: string) {
    return this.events.getEventById(id);
  }

  async getRouting(id: string) {
    const [event, routing] = await Promise.all([
      this.events.getEventById(id),
      this.router.getEventRouting(id),
    ]);
    return event ? routing : null;
  }

  ingest(event: EventEnvelope) {
    return this.events.ingestEvent(event);
  }
}

export const createEventsHandlers = (
  events: EventsPort,
  router: EventRoutingPort,
): EventsHandlers => new EventsHandlers(events, router);
