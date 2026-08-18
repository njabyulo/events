import 'dotenv/config';
import { hasWebhookAdapter } from "./webhook.adapters.js";
import { asJsonObject, WebhookError } from "./webhook.types.js";
import { Env } from "../../../config/env.js";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export function maxBodyBytes() {
  return Env.integer("WEBHOOK_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES);
}

export type WebhookSource = {
  key: string;
  provider: string;
  source: string;
  secret: string;
};

type WebhookSourceDefinition = {
  provider: string;
  source: string;
  secretEnv: string;
};

const builtInSources = new Map<string, WebhookSourceDefinition>([
  ["github", {
    provider: "github",
    source: "github",
    secretEnv: "GITHUB_WEBHOOK_SECRET",
  }],
  ["generic", {
    provider: "generic-hmac",
    source: "generic",
    secretEnv: "GENERIC_WEBHOOK_SECRET",
  }],
  ["telegram", {
    provider: "telegram",
    source: "telegram",
    secretEnv: "TELEGRAM_WEBHOOK_SECRET",
  }],
]);

function isDefinition(value: unknown): value is WebhookSourceDefinition {
  const definition = asJsonObject(value);
  return definition !== undefined
    && typeof definition.provider === "string" && definition.provider.trim().length > 0
    && typeof definition.source === "string" && definition.source.trim().length > 0
    && typeof definition.secretEnv === "string" && definition.secretEnv.trim().length > 0;
}

function parseConfiguredSources() {
  const value = process.env.WEBHOOK_SOURCES_JSON;
  if (!value) return new Map<string, WebhookSourceDefinition>();

  try {
    const parsed = asJsonObject(JSON.parse(value));
    if (!parsed) {
      throw new Error("expected an object");
    }

    const definitions = new Map<string, WebhookSourceDefinition>();
    for (const [key, definition] of Object.entries(parsed)) {
      if (!isDefinition(definition)) {
        throw new Error(`invalid definition for ${key}`);
      }
      if (!hasWebhookAdapter(definition.provider)) {
        throw new Error(`unknown provider "${definition.provider}" for ${key}`);
      }
      definitions.set(key, definition);
    }

    return definitions;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new WebhookError(503, "invalid_webhook_configuration", `WEBHOOK_SOURCES_JSON is invalid: ${reason}`);
  }
}

let cachedSources: Map<string, WebhookSourceDefinition> | undefined;
let cachedError: WebhookError | undefined;

function configuredSources() {
  if (cachedSources) return cachedSources;
  if (cachedError) throw cachedError;

  try {
    cachedSources = parseConfiguredSources();
    return cachedSources;
  } catch (error) {
    cachedError = error instanceof WebhookError
      ? error
      : new WebhookError(503, "invalid_webhook_configuration", "WEBHOOK_SOURCES_JSON is invalid");
    throw cachedError;
  }
}

export function resolveWebhookSource(key: string): WebhookSource {
  const definition = configuredSources().get(key) ?? builtInSources.get(key);
  if (!definition) {
    throw new WebhookError(404, "unknown_webhook_source", "Webhook source does not exist");
  }

  const secret = process.env[definition.secretEnv];
  if (!secret) {
    throw new WebhookError(503, "webhook_source_unavailable", "Webhook source is not configured");
  }

  return {
    key,
    provider: definition.provider,
    source: definition.source,
    secret,
  };
}
