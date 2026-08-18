import { createStreamsService } from "core/triage";
import { streamsRepo } from "database/triage";
import { triageConfig } from "./triage.config.js";
import { createStreamsHandlers } from "./triage.handlers.js";

export const streamsService = createStreamsService(streamsRepo);
export const streamsHandlers = createStreamsHandlers(streamsService, triageConfig.streamKey);
