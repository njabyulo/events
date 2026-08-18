export type JsonObject = Record<string, unknown>;

export function asJsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export type WebhookRequest = {
  headers: Headers;
  rawBody: Uint8Array;
  receivedAt: Date;
  secret: string;
};

export type VerifiedWebhookRequest = Omit<WebhookRequest, "secret">;

export type NormalizedWebhookEvent = {
  sourceEventId: string;
  sourceEventType: string;
  type: string;
  actor: string | null;
  subject: string | null;
  summary: string | null;
  occurredAt: string;
  correlationId: string | null;
  causationEventId: string | null;
  traceId: string | null;
  detail: JsonObject;
  attributes: JsonObject;
  links: Array<{ kind: string; value: string }>;
};

export interface WebhookAdapter {
  readonly provider: string;
  verify(request: WebhookRequest): Promise<void>;
  normalize(request: VerifiedWebhookRequest): Promise<NormalizedWebhookEvent>;
}

export type WebhookErrorStatus = 400 | 401 | 404 | 413 | 415 | 503;

export class WebhookError extends Error {
  constructor(
    readonly status: WebhookErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}
