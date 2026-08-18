export const triageConfig = {
  streamKey: process.env.DASHBOARD_STREAM_KEY?.trim() || "triage",
} as const;
