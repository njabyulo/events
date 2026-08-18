import { SmsDeliveryError, type SmsClient } from "core/escalations";
import { escalationsConfig } from "../../modules/escalations/escalations.config.js";

export class TwilioSmsClient implements SmsClient {
  constructor(
    private readonly config: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
      destinationNumber: string;
      apiBaseUrl: string;
    },
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(body: string): Promise<{ sid: string }> {
    let response: Response;
    try {
      response = await this.request(
        `${this.config.apiBaseUrl}/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(
              `${this.config.accountSid}:${this.config.authToken}`,
            ).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: this.config.destinationNumber,
            From: this.config.fromNumber,
            Body: body,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new SmsDeliveryError("Twilio request failed", true);
    }

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok && typeof payload.sid === "string" && payload.sid.length > 0) {
      return { sid: payload.sid };
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const retryable = response.status === 429 || response.status >= 500;
    throw new SmsDeliveryError(
      `Twilio rejected the message (${response.status})`,
      retryable,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3_600) : undefined,
    );
  }
}

export const twilioSmsClient = new TwilioSmsClient(escalationsConfig);
