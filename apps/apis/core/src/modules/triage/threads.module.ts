import { createThreadsService } from "core/triage";
import { threadsRepo } from "database/triage";
import { agentService } from "../agents/agent.module.js";
import { triageConfig } from "./triage.config.js";
import { createThreadsHandlers } from "./triage.handlers.js";

export const threadsService = createThreadsService(threadsRepo);
export const threadsHandlers = createThreadsHandlers(
  threadsService,
  agentService,
  triageConfig.streamKey,
);
