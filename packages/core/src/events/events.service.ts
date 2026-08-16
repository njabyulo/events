import { EventsUtils } from "./event.utils.js";
import {
  eventsRepo,
  type EventsRepo,
  type EventToIngest,
  type IngestEventResult,
  type StoredEvent,
} from "database/events";

export type EventsRepository = Pick<
  EventsRepo,
  "getEvents" | "getEventById" | "ingestEvent"
>;

export type EventsServiceDependencies = {
  eventsRepository: EventsRepository;
};

export type CreateEventsServiceOptions = Partial<EventsServiceDependencies>;

export class EventsService {
  constructor(private readonly dependencies: EventsServiceDependencies) {}

  async getEvents(): Promise<StoredEvent[]> {
    return this.dependencies.eventsRepository.getEvents();
  }

  async getEventById(id: string): Promise<StoredEvent | null> {
    if (!EventsUtils.isValidEventId(id)) return null;
    return this.dependencies.eventsRepository.getEventById(id);
  }

  async ingestEvent(event: EventToIngest): Promise<IngestEventResult> {
    return this.dependencies.eventsRepository.ingestEvent(event);
  }
}

export const createEventsService = (
  options: CreateEventsServiceOptions = {},
): EventsService => new EventsService({
  eventsRepository: options.eventsRepository ?? eventsRepo,
});

export type {
  EventsRepo,
  EventToIngest,
  IngestEventResult,
  JsonObject,
  StoredEvent,
} from "database/events";
