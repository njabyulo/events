import { expect, test } from "vitest";
import { genericHmacWebhookAdapter } from "../../../src/transport/http/webhooks/providers/generic-hmac.adapter.js";
import { githubWebhookAdapter } from "../../../src/transport/http/webhooks/providers/github.adapter.js";
import { telegramWebhookAdapter } from "../../../src/transport/http/webhooks/providers/telegram.adapter.js";
import { hmacSha256 } from "../../../src/transport/http/webhooks/hmac.js";

const secret = "test-secret";

function request(headers: Headers, body: string, receivedAt = new Date("2026-08-15T10:00:00.000Z")) {
  return {
    headers,
    rawBody: new TextEncoder().encode(body),
    receivedAt,
    secret,
  };
}

test("GitHub adapter verifies raw bytes and normalizes the event", async () => {
  const body = JSON.stringify({
    action: "deleted",
    ref: "old-feature",
    ref_type: "branch",
    repository: { full_name: "njabulo/events" },
    sender: { login: "njabulo" },
  });
  const rawBody = new TextEncoder().encode(body);
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-delivery": "delivery-1",
    "x-github-event": "delete",
    "x-hub-signature-256": hmacSha256(secret, rawBody),
  });
  const input = request(headers, body);

  await githubWebhookAdapter.verify(input);
  const event = await githubWebhookAdapter.normalize(input);

  expect(event.sourceEventId).toBe("delivery-1");
  expect(event.sourceEventType).toBe("delete");
  expect(event.type).toBe("branch.deleted");
  expect(event.attributes.repository).toBe("njabulo/events");
  expect(event.links).toContainEqual({
    kind: "repository",
    value: "njabulo/events",
  });
  expect(event.detail).toMatchObject({
    sourceEventType: "delete",
    raw: { action: "deleted" },
  });
});

test("GitHub adapter rejects a signature for different raw bytes", async () => {
  const signedBody = new TextEncoder().encode('{"action":"created"}');
  const headers = new Headers({
    "x-hub-signature-256": hmacSha256(secret, signedBody),
  });

  await expect(
    githubWebhookAdapter.verify(request(headers, '{"action":"deleted"}')),
  ).rejects.toMatchObject({ code: "invalid_signature" });
});

test("GitHub adapter accepts form payloads and emits semantic merged events", async () => {
  const payload = {
    action: "closed",
    pull_request: {
      number: 42,
      merged: true,
      merged_at: "2026-08-15T09:58:00Z",
      merge_commit_sha: "abc123",
    },
    repository: { full_name: "njabulo/events" },
    sender: { login: "njabulo" },
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const rawBody = new TextEncoder().encode(body);
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    "x-github-delivery": "delivery-merged-1",
    "x-github-event": "pull_request",
    "x-hub-signature-256": hmacSha256(secret, rawBody),
  });
  const input = request(headers, body);

  await githubWebhookAdapter.verify(input);
  const event = await githubWebhookAdapter.normalize(input);

  expect(event.type).toBe("pull_request.merged");
  expect(event.occurredAt).toBe("2026-08-15T09:58:00.000Z");
  expect(event.links).toEqual(expect.arrayContaining([
    { kind: "repository", value: "njabulo/events" },
    { kind: "pull_request", value: "njabulo/events#42" },
    { kind: "commit_sha", value: "abc123" },
  ]));
});

test("generic adapter verifies timestamp plus raw body", async () => {
  const receivedAt = new Date("2026-08-15T10:00:00.000Z");
  const timestamp = String(Math.floor(receivedAt.getTime() / 1000));
  const body = JSON.stringify({
    type: "personal.message.received",
    actor: "Sam",
    subject: "Weekend plan",
    summary: "Sam sent a message",
    occurredAt: "2026-08-15T09:59:30.000Z",
    attributes: { area: "personal" },
  });
  const signedBody = Buffer.concat([
    Buffer.from(`${timestamp}.`),
    Buffer.from(body),
  ]);
  const headers = new Headers({
    "x-event-id": "message-42",
    "x-event-type": "message.received",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature-256": hmacSha256(secret, signedBody),
  });
  const input = request(headers, body, receivedAt);

  await genericHmacWebhookAdapter.verify(input);
  const event = await genericHmacWebhookAdapter.normalize(input);

  expect(event.sourceEventId).toBe("message-42");
  expect(event.type).toBe("personal.message.received");
  expect(event.attributes.area).toBe("personal");
});

test("generic adapter rejects stale signed requests", async () => {
  const timestamp = String(Date.parse("2026-08-15T09:00:00.000Z") / 1000);
  const body = JSON.stringify({ type: "personal.reminder.created" });
  const signedBody = Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(body)]);
  const headers = new Headers({
    "x-event-id": "reminder-1",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature-256": hmacSha256(secret, signedBody),
  });

  await expect(
    genericHmacWebhookAdapter.verify(request(headers, body)),
  ).rejects.toMatchObject({ code: "stale_webhook" });
});

test("Telegram adapter verifies its secret header and normalizes callback actions", async () => {
  const body = JSON.stringify({
    update_id: 42,
    callback_query: {
      id: "callback-1",
      data: "event.review:101",
      from: { id: 7, username: "njabulo" },
      message: { message_id: 9, date: 1_787_000_000, chat: { id: 123 } },
    },
  });
  const input = request(new Headers({
    "x-telegram-bot-api-secret-token": secret,
  }), body);

  await telegramWebhookAdapter.verify(input);
  const event = await telegramWebhookAdapter.normalize(input);

  expect(event).toMatchObject({
    sourceEventId: "42",
    type: "telegram.action",
    actor: "njabulo",
    correlationId: "123",
    attributes: { action: "event.review:101" },
  });
});
