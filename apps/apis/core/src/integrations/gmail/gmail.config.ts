import "dotenv/config";
import { Env } from "../../config/env.js";

const DEFAULT_POLL_INTERVAL_MS = 120_000;

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  labelId: string;
  userId: string;
  pollIntervalMs: number;
};

export class GmailSourceError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GmailSourceError";
  }
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new GmailSourceError(
      503,
      "gmail_source_unavailable",
      `${name} is required for Gmail polling`,
    );
  }
  return value;
}

export function isGmailPollingEnabled(): boolean {
  if (!Env.boolean("GMAIL_POLL_ENABLED", true)) return false;
  return [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "GMAIL_LABEL_ID",
  ].every((name) => Boolean(process.env[name]?.trim()));
}

export function loadGmailConfig(): GmailConfig {
  return {
    clientId: requiredEnvironmentValue("GMAIL_CLIENT_ID"),
    clientSecret: requiredEnvironmentValue("GMAIL_CLIENT_SECRET"),
    refreshToken: requiredEnvironmentValue("GMAIL_REFRESH_TOKEN"),
    labelId: requiredEnvironmentValue("GMAIL_LABEL_ID"),
    userId: process.env.GMAIL_USER_ID?.trim() || "me",
    pollIntervalMs: Env.integer(
      "GMAIL_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
      { minimum: 10_000 },
    ),
  };
}
