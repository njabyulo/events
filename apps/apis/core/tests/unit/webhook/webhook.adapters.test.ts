import { expect, test } from "vitest";
import { genericHmacWebhookAdapter } from "../../../src/modules/events/webhooks/providers/generic-hmac.adapter.js";
import { githubWebhookAdapter } from "../../../src/modules/events/webhooks/providers/github.adapter.js";
import { hmacSha256 } from "../../../src/modules/events/webhooks/hmac.js";

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
