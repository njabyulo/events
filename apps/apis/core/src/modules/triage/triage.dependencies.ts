import { createStreamsService, createTriageService } from "core/triage";
import { streamsRepo, triageRepo } from "database/triage";

export const triageService = createTriageService(triageRepo);
export const streamsService = createStreamsService(streamsRepo);
