import type {
  EventLink,
  EventsRepo,
  IngestEventResult,
  JsonObject,
  StoredEvent,
} from "database/events";
import {
  EventValidationError,
  EventsUtils,
} from "./event.utils.js";

export type EventEnvelope = {
  source: string;
  sourceEventId?: string;
  type: string;
  subject?: string | null;
  actor?: string | null;
  summary?: string | null;
  occurredAt: string;
  correlationId?: string | null;
  causationEventId?: number | string | null;
  traceId?: string | null;
  detail: JsonObject;
  attributes?: JsonObject;
  links?: EventLink[];
};

export type EventValidationLimits = {
  detailBytes: number;
  maxLinks: number;
  linkKindLength: number;
  linkValueLength: number;
};

export type EventsRepository = Pick<
  EventsRepo,
  | "getEvents"
  | "getEventById"
  | "ingestEvent"
  | "getSourceCursor"
  | "setSourceCursor"
>;

export type EventsServiceDependencies = {
  eventsRepository: EventsRepository;
  validationLimits: EventValidationLimits;
};

export class EventStoreUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super("Event store is unavailable");
    this.name = "EventStoreUnavailableError";
  }
}

export class EventsService {
  constructor(private readonly dependencies: EventsServiceDependencies) {}

  async getEvents(): Promise<StoredEvent[]> {
    try {
      return await this.dependencies.eventsRepository.getEvents();
    } catch (error) {
      throw new EventStoreUnavailableError(error);
    }
  }

  async getEventById(id: string): Promise<StoredEvent | null> {
    if (!EventsUtils.isValidEventId(id)) return null;

    try {
      return await this.dependencies.eventsRepository.getEventById(id);
    } catch (error) {
      throw new EventStoreUnavailableError(error);
    }
  }

  async ingestEvent(envelope: EventEnvelope): Promise<IngestEventResult> {
    const event = EventsUtils.normalizeEnvelope(
      envelope,
      this.dependencies.validationLimits,
    );

    try {
      if (
        event.causationEventId !== null
        && await this.dependencies.eventsRepository.getEventById(event.causationEventId) === null
      ) {
        throw new EventValidationError(
          "causation_event_not_found",
          "causationEventId does not reference an existing event",
        );
      }

      return await this.dependencies.eventsRepository.ingestEvent(event);
    } catch (error) {
      if (error instanceof EventValidationError) throw error;
      throw new EventStoreUnavailableError(error);
    }
  }

  async getSourceCursor(source: string, key: string): Promise<string | null> {
    try {
      return await this.dependencies.eventsRepository.getSourceCursor(source, key);
    } catch (error) {
      throw new EventStoreUnavailableError(error);
    }
  }

  async setSourceCursor(source: string, key: string, cursor: string): Promise<void> {
    try {
      await this.dependencies.eventsRepository.setSourceCursor(source, key, cursor);
    } catch (error) {
      throw new EventStoreUnavailableError(error);
    }
  }
}

export const createEventsService = (
  dependencies: Pick<EventsServiceDependencies, "eventsRepository">
    & Partial<Pick<EventsServiceDependencies, "validationLimits">>,
): EventsService => new EventsService({
  eventsRepository: dependencies.eventsRepository,
  validationLimits: dependencies.validationLimits
    ?? EventsUtils.DEFAULT_VALIDATION_LIMITS,
});

export {
  EventValidationError,
  EventsUtils,
} from "./event.utils.js";
export type {
  EventLink,
  EventToIngest,
  IngestEventResult,
  JsonObject,
  StoredEvent,
} from "database/events";
