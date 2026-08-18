import { hmacSha256, signaturesMatch } from "../hmac.js";
import { requiredHeader } from "../webhook.helpers.js";
import type { JsonObject, NormalizedWebhookEvent, WebhookAdapter, WebhookRequest } from "../webhook.types.js";
import { asJsonObject, WebhookError } from "../webhook.types.js";

const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300;

function jsonObject(rawBody: Uint8Array): JsonObject {
  try {
    const value = asJsonObject(JSON.parse(Buffer.from(rawBody).toString("utf8")));
    if (!value) throw new Error("body must be a JSON object");
    return value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new WebhookError(400, "invalid_payload", `Invalid JSON payload: ${reason}`);
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function occurredAt(value: unknown, fallback: Date) {
  if (typeof value !== "string") return fallback.toISOString();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new WebhookError(400, "invalid_occurred_at", "occurredAt must be a valid timestamp");
  }
  return parsed.toISOString();
}

export const genericHmacWebhookAdapter: WebhookAdapter = {
  provider: "generic-hmac",

  async verify({ headers, rawBody, receivedAt, secret }: WebhookRequest) {
    const timestamp = requiredHeader(headers, "x-webhook-timestamp");
    const signature = requiredHeader(headers, "x-webhook-signature-256");
    const timestampSeconds = Number(timestamp);

    if (!Number.isInteger(timestampSeconds)) {
      throw new WebhookError(400, "invalid_timestamp", "Webhook timestamp must use Unix seconds");
    }

    const maxClockSkew = Number(process.env.WEBHOOK_MAX_CLOCK_SKEW_SECONDS)
      || DEFAULT_MAX_CLOCK_SKEW_SECONDS;
    const clockSkew = Math.abs(receivedAt.getTime() - timestampSeconds * 1000) / 1000;
    if (clockSkew > maxClockSkew) {
      throw new WebhookError(401, "stale_webhook", "Webhook timestamp is outside the allowed window");
    }

    const signedBody = Buffer.concat([
      Buffer.from(`${timestamp}.`, "utf8"),
      Buffer.from(rawBody),
    ]);
    const expected = hmacSha256(secret, signedBody);
    if (!signaturesMatch(signature, expected)) {
      throw new WebhookError(401, "invalid_signature", "Webhook signature is invalid");
    }
  },

  async normalize({ headers, rawBody, receivedAt }) {
    const payload = jsonObject(rawBody);
    const type = optionalString(payload.type);
    if (!type) throw new WebhookError(400, "missing_event_type", "Payload type is required");

    return {
      sourceEventId: requiredHeader(headers, "x-event-id"),
      sourceEventType: headers.get("x-event-type")?.trim() || type,
      type,
      actor: optionalString(payload.actor),
      subject: optionalString(payload.subject),
      summary: optionalString(payload.summary),
      occurredAt: occurredAt(payload.occurredAt, receivedAt),
      correlationId: optionalString(payload.correlationId),
      causationEventId: optionalString(payload.causationEventId),
      traceId: optionalString(payload.traceId),
      detail: asJsonObject(payload.detail) ?? payload,
      attributes: asJsonObject(payload.attributes) ?? {},
      links: Array.isArray(payload.links)
        ? payload.links as Array<{ kind: string; value: string }>
        : [],
    } satisfies NormalizedWebhookEvent;
  },
};
