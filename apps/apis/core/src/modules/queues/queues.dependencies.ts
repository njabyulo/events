import { createQueuesService } from "core/queues";
import { queuesRepo } from "database/queues";

export const queuesService = createQueuesService(queuesRepo);
