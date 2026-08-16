import { describe, expect, test, vi } from "vitest";
import type {
  EventEnvelope,
  IngestEventResult,
} from "../../../src/events/events.service.js";
import {
  createGmailService,
  GmailHistoryExpiredError,
  GmailUtils,
  type GmailClient,
  type GmailEventsService,
  type GmailMessage,
} from "../../../src/gmail/index.js";

const message: GmailMessage = {
  id: "msg-1",
  threadId: "thread-1",
  internalDate: String(Date.parse("2026-08-16T11:58:03Z")),
  labelIds: ["TRIAGE"],
  snippet: "Please find attached...",
  payload: {
    headers: [
      { name: "Subject", value: "Invoice from accountant" },
      { name: "From", value: "Accountant <accountant@example.com>" },
    ],
  },
};

function fakeClient(overrides: Partial<GmailClient> = {}): GmailClient {
  return {
    getProfile: vi.fn(async () => ({ historyId: "100" })),
    listMessages: vi.fn(async () => ({ messages: [{ id: "msg-1" }] })),
    listHistory: vi.fn(async () => ({
      history: [{ messagesAdded: [{ message: { id: "msg-1" } }] }],
      historyId: "101",
    })),
    getMessage: vi.fn(async () => message),
    ...overrides,
  };
}

function inMemoryEventsService(initialCursor: string | null = null) {
  let cursor = initialCursor;
  const storedIds = new Set<string>();

  const service: GmailEventsService = {
    ingestEvent: vi.fn(async (event: EventEnvelope): Promise<IngestEventResult> => {
      const sourceEventId = event.sourceEventId!;
      const inserted = !storedIds.has(sourceEventId);
      storedIds.add(sourceEventId);
      return { id: "1", sourceEventId, inserted };
    }),
    getSourceCursor: vi.fn(async () => cursor),
    setSourceCursor: vi.fn(async (_source, _key, value) => {
      cursor = value;
    }),
  };

  return { service, storedIds, cursor: () => cursor };
}

function gmailService(client: GmailClient, eventsService: GmailEventsService) {
  return createGmailService({
    client,
    eventsService,
    source: { userId: "me", labelId: "TRIAGE" },
  });
}

describe("Gmail ingestion", () => {
  test("normalizes only bounded message metadata", () => {
    expect(GmailUtils.normalizeMessage(message)).toEqual(expect.objectContaining({
      source: "gmail",
      sourceEventId: "msg-1",
      type: "email.received",
      subject: "Invoice from accountant",
      actor: "accountant@example.com",
      summary: "Invoice from accountant",
      detail: {
        threadId: "thread-1",
        labels: ["TRIAGE"],
        snippet: "Please find attached...",
      },
      links: [{ kind: "thread_id", value: "thread-1" }],
    }));
  });

  test("polling overlapping Gmail history stores one event", async () => {
    const state = inMemoryEventsService();
    const service = gmailService(fakeClient(), state.service);

    await expect(service.poll()).resolves.toMatchObject({
      mode: "full",
      inserted: 1,
      duplicates: 0,
      historyId: "100",
    });
    await expect(service.poll()).resolves.toMatchObject({
      mode: "history",
      inserted: 0,
      duplicates: 1,
      historyId: "101",
    });

    expect(state.storedIds).toEqual(new Set(["msg-1"]));
    expect(state.cursor()).toBe("101");
  });

  test("does not advance history when event ingestion fails", async () => {
    const state = inMemoryEventsService("100");
    vi.mocked(state.service.ingestEvent).mockRejectedValueOnce(
      new Error("database failed"),
    );
    const service = gmailService(fakeClient(), state.service);

    await expect(service.poll()).rejects.toThrow("database failed");
    expect(state.cursor()).toBe("100");
    expect(state.service.setSourceCursor).not.toHaveBeenCalled();
  });

  test("falls back to a full label sync when Gmail history expires", async () => {
    const state = inMemoryEventsService("old-history");
    const client = fakeClient({
      listHistory: vi.fn(async () => {
        throw new GmailHistoryExpiredError();
      }),
    });

    await expect(gmailService(client, state.service).poll()).resolves.toMatchObject({
      mode: "full",
      inserted: 1,
      historyId: "100",
    });
    expect(client.listMessages).toHaveBeenCalledOnce();
  });
});
