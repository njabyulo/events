import { genericHmacWebhookAdapter } from "./providers/generic-hmac.adapter.js";
import { githubWebhookAdapter } from "./providers/github.adapter.js";
import { telegramWebhookAdapter } from "./providers/telegram.adapter.js";
import type { WebhookAdapter } from "./webhook.types.js";
import { WebhookError } from "./webhook.types.js";

const adapters = new Map<string, WebhookAdapter>([
  [githubWebhookAdapter.provider, githubWebhookAdapter],
  [genericHmacWebhookAdapter.provider, genericHmacWebhookAdapter],
  [telegramWebhookAdapter.provider, telegramWebhookAdapter],
]);

export function hasWebhookAdapter(provider: string) {
  return adapters.has(provider);
}

export function webhookAdapterFor(provider: string) {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new WebhookError(503, "unsupported_webhook_provider", "Webhook provider is not supported");
  }
  return adapter;
}
