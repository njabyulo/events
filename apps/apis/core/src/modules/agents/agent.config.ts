import { Env } from "../../config/env.js";

export const agentConfig = {
  modelId: process.env.STRANDS_MODEL_ID?.trim() || "global.anthropic.claude-sonnet-4-6",
  region: process.env.AWS_REGION?.trim() || "us-east-1",
  maxTokens: Env.integer("STRANDS_MAX_TOKENS", 512, { minimum: 64 }),
  confidenceThreshold: Env.number("AGENT_CONFIDENCE_THRESHOLD", 0.75, { minimum: 0, maximum: 1 }),
  maxCandidateThreads: Env.integer("AGENT_MAX_CANDIDATE_THREADS", 20),
  maxHistoryEvents: Env.integer("AGENT_MAX_HISTORY_EVENTS", 30),
  maxHistoryCharacters: Env.integer("AGENT_MAX_HISTORY_CHARACTERS", 12_000, { minimum: 1_000 }),
} as const;
