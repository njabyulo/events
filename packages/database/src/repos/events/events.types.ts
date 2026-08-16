export type JsonObject = Record<string, unknown>;

export type EventToIngest = {
  source: string;
  sourceEventId: string;
  type: string;
  subject: string | null;
  actor: string | null;
  summary: string | null;
  occurredAt: string;
  detail: JsonObject;
  attributes: JsonObject;
};

export type IngestEventResult = {
  id: string;
  inserted: boolean;
};

export type StoredEvent = {
  id: string;
  source: string;
  sourceEventId: string | null;
  type: string;
  subject: string | null;
  actor: string | null;
  summary: string | null;
  occurredAt: string;
  ingestedAt: string;
  detail: JsonObject;
  attributes: JsonObject;
};
