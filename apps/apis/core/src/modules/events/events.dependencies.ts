import { createEventsService } from "core/events";
import { eventsRepo } from "database/events";

export const eventsService = createEventsService({ eventsRepository: eventsRepo });
