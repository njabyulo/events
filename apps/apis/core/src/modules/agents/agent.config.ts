function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function fraction(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export const agentConfig = {
  modelId: process.env.STRANDS_MODEL_ID?.trim() || "global.anthropic.claude-sonnet-4-6",
  region: process.env.AWS_REGION?.trim() || "us-east-1",
  maxTokens: positiveInteger("STRANDS_MAX_TOKENS", 512, 64),
  confidenceThreshold: fraction("AGENT_CONFIDENCE_THRESHOLD", 0.75),
  maxCandidateThreads: positiveInteger("AGENT_MAX_CANDIDATE_THREADS", 20),
  maxHistoryEvents: positiveInteger("AGENT_MAX_HISTORY_EVENTS", 30),
  maxHistoryCharacters: positiveInteger("AGENT_MAX_HISTORY_CHARACTERS", 12_000, 1_000),
} as const;
