import { describe, expect, test, vi } from "vitest";
import { TwilioSmsClient } from "../../../src/integrations/twilio/twilio.client.js";

const config = {
  accountSid: "AC123",
  authToken: "secret",
  fromNumber: "+27110000000",
  destinationNumber: "+27820000000",
  apiBaseUrl: "https://twilio.example",
};

describe("TwilioSmsClient", () => {
  test("sends form data and returns the Twilio SID", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ sid: "SM123" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    const client = new TwilioSmsClient(config, request as typeof fetch);

    await expect(client.send("Urgent summary")).resolves.toEqual({ sid: "SM123" });
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("Body=Urgent+summary");
    expect(String(init.body)).not.toContain(config.authToken);
  });

  test("classifies rate limits as retryable without exposing response bodies", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      message: "provider detail that should not escape",
    }), {
      status: 429,
      headers: { "retry-after": "120", "content-type": "application/json" },
    }));
    const client = new TwilioSmsClient(config, request as typeof fetch);

    await expect(client.send("Urgent summary")).rejects.toMatchObject({
      retryable: true,
      retryAfterSeconds: 120,
      message: "Twilio rejected the message (429)",
    });
  });
});
