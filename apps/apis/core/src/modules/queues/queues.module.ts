import { createQueuesService } from "core/queues";
import { queuesRepo } from "database/queues";
import { digestService } from "../digests/digest.module.js";
import { createQueuesHandlers } from "./queues.handlers.js";

export const queuesService = createQueuesService(queuesRepo);
export const queuesHandlers = createQueuesHandlers(queuesService, digestService);
