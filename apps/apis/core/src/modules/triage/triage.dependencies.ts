import { createStreamsService, createThreadsService, createTriageService } from "core/triage";
import { streamsRepo, threadsRepo, triageRepo } from "database/triage";

export const triageService = createTriageService(triageRepo);
export const streamsService = createStreamsService(streamsRepo);
export const threadsService = createThreadsService(threadsRepo);
