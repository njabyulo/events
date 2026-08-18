import { createEventsService } from "core/events";
import { eventsRepo } from "database/events";
import { routerService } from "../routing/routing.module.js";
import { createEventsHandlers } from "./events.handlers.js";

export const eventsService = createEventsService({ eventsRepository: eventsRepo });
export const eventsHandlers = createEventsHandlers(eventsService, routerService);
