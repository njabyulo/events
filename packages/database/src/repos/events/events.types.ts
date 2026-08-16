export type JsonObject = Record<string, unknown>;

export type EventLink = {
  kind: string;
  value: string;
};

export type EventToIngest = {
  source: string;
  sourceEventId: string;
  type: string;
  subject: string | null;
  actor: string | null;
  summary: string | null;
  occurredAt: string;
  correlationId: string | null;
  causationEventId: string | null;
  traceId: string | null;
  detail: JsonObject;
  attributes: JsonObject;
  links: EventLink[];
};

export type IngestEventResult = {
  id: string;
  sourceEventId: string;
  inserted: boolean;
};

export type StoredEvent = EventToIngest & {
  id: string;
  ingestedAt: string;
};
