import { createTriageService } from "core/triage";
import { triageRepo } from "database/triage";
import { triageConfig } from "./triage.config.js";
import { createTriageHandlers } from "./triage.handlers.js";

export const triageService = createTriageService(triageRepo);
export const triageHandlers = createTriageHandlers(triageService, triageConfig.streamKey);
