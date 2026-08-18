import { createAgentService, createStrandsTriageAgentClient } from "core/agents";
import { threadsRepo } from "database/triage";
import { eventsService } from "../events/events.module.js";
import { agentConfig } from "./agent.config.js";

export const strandsAgentClient = createStrandsTriageAgentClient({
  modelId: agentConfig.modelId,
  region: agentConfig.region,
  maxTokens: agentConfig.maxTokens,
});

export const agentService = createAgentService({
  agent: strandsAgentClient,
  publisher: eventsService,
  threads: threadsRepo,
  config: {
    confidenceThreshold: agentConfig.confidenceThreshold,
    modelId: agentConfig.modelId,
    maxCandidateThreads: agentConfig.maxCandidateThreads,
    maxHistoryEvents: agentConfig.maxHistoryEvents,
    maxHistoryCharacters: agentConfig.maxHistoryCharacters,
  },
});
