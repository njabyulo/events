import { createEscalationsService } from "core/escalations";
import { escalationsRepo } from "database/escalations";
import { escalationsConfig } from "./escalations.config.js";
import { twilioSmsClient } from "../../integrations/twilio/twilio.client.js";
import { createEscalationsHandlers } from "./escalations.handlers.js";

export const escalationsService = createEscalationsService(
  escalationsRepo,
  twilioSmsClient,
  {
    leaseSeconds: escalationsConfig.leaseSeconds,
    maxAttempts: escalationsConfig.maxAttempts,
    rateLimitPerHour: escalationsConfig.rateLimitPerHour,
    rateLimitPerDay: escalationsConfig.rateLimitPerDay,
  },
);

export const escalationsHandlers = createEscalationsHandlers(escalationsService);
