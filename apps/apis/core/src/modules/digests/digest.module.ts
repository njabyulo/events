import { createDigestService } from "core/digests";
import { queuesRepo } from "database/queues";
import { eventsService } from "../events/events.module.js";
import { digestConfig } from "./digest.config.js";

export const digestService = createDigestService({
  repository: queuesRepo,
  publisher: eventsService,
  consumerName: digestConfig.consumerName,
  visibilityTimeoutSeconds: digestConfig.visibilityTimeoutSeconds,
  batchSize: digestConfig.batchSize,
});
