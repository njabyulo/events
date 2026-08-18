import { describe, expect, test, vi } from "vitest";
import { GmailHistoryExpiredError } from "core/gmail";
import { GoogleGmailClient } from "../../../src/integrations/gmail/gmail.client.js";
import type { GmailConfig } from "../../../src/integrations/gmail/gmail.config.js";

const config: GmailConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  labelId: "TRIAGE",
  userId: "me",
  pollIntervalMs: 120_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GoogleGmailClient", () => {
  test("refreshes OAuth and lists only messages under the configured label", async () => {
    const requestFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "msg-1" }] }));
    const client = new GoogleGmailClient(config, requestFetch as typeof fetch);

    await expect(client.listMessages("next-page")).resolves.toEqual({
      messages: [{ id: "msg-1" }],
    });

    expect(requestFetch).toHaveBeenNthCalledWith(
      1,
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    const apiUrl = new URL(requestFetch.mock.calls[1]![0] as string);
    expect(apiUrl.pathname).toBe("/gmail/v1/users/me/messages");
    expect(apiUrl.searchParams.get("labelIds")).toBe("TRIAGE");
    expect(apiUrl.searchParams.get("pageToken")).toBe("next-page");
    expect(requestFetch.mock.calls[1]![1]).toEqual(expect.objectContaining({
      headers: { authorization: "Bearer access-token" },
    }));
  });

  test("maps an expired Gmail history cursor to the core recovery signal", async () => {
    const requestFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
    const client = new GoogleGmailClient(config, requestFetch as typeof fetch);

    await expect(client.listHistory("expired-history")).rejects.toBeInstanceOf(
      GmailHistoryExpiredError,
    );
  });

  test("returns null when a message disappears before metadata is fetched", async () => {
    const requestFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
    const client = new GoogleGmailClient(config, requestFetch as typeof fetch);

    await expect(client.getMessage("deleted-message")).resolves.toBeNull();
  });
});
