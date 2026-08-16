import { normalizeGithubEvent, parseGithubPayload } from "./github.normalizer.js";
import { hmacSha256, signaturesMatch } from "../hmac.js";
import { requiredHeader } from "../webhook.helpers.js";
import type { JsonObject, WebhookAdapter, WebhookRequest } from "../webhook.types.js";
import { asJsonObject, WebhookError } from "../webhook.types.js";

export const githubWebhookAdapter: WebhookAdapter = {
  provider: "github",

  async verify({ headers, rawBody, secret }: WebhookRequest) {
    const signature = headers.get("x-hub-signature-256") ?? undefined;
    const expected = hmacSha256(secret, rawBody);

    if (!signaturesMatch(signature, expected)) {
      throw new WebhookError(401, "invalid_signature", "Webhook signature is invalid");
    }
  },

  async normalize({ headers, rawBody, receivedAt }) {
    const sourceEventType = requiredHeader(headers, "x-github-event");
    const sourceEventId = requiredHeader(headers, "x-github-delivery");
    const body = Buffer.from(rawBody).toString("utf8");

    let payload: JsonObject;
    try {
      const parsed = asJsonObject(parseGithubPayload(body, headers.get("content-type") ?? undefined));
      if (!parsed) throw new Error("body must be a JSON object");
      payload = parsed;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid payload";
      throw new WebhookError(400, "invalid_payload", `Invalid GitHub payload: ${reason}`);
    }

    const event = normalizeGithubEvent(sourceEventType, payload, receivedAt.toISOString());

    return {
      sourceEventId,
      sourceEventType,
      type: event.eventType,
      actor: event.actor,
      subject: event.subject,
      summary: event.summary,
      occurredAt: event.occurredAt,
      detail: payload,
      attributes: {
        environment: event.environment,
        service: event.service,
        repository: event.repository,
        commit_sha: event.commitSha,
        deployment_id: event.deploymentId,
        deployment_url: event.deploymentUrl,
        pr_number: event.prNumber,
      },
    };
  },
};
