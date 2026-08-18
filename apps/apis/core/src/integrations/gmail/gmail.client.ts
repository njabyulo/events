import {
  GmailHistoryExpiredError,
  type GmailClient,
  type GmailHistoryPage,
  type GmailMessage,
  type GmailMessagesPage,
} from "core/gmail";
import { GmailSourceError, type GmailConfig } from "./gmail.config.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";

class GmailApiError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API request failed with ${status}`);
    this.name = "GmailApiError";
  }
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
};

export class GoogleGmailClient implements GmailClient {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly config: GmailConfig,
    private readonly requestFetch: typeof fetch = fetch,
  ) {}

  private async refreshAccessToken(): Promise<string> {
    const response = await this.requestFetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      throw new GmailSourceError(
        response.status === 401 ? 401 : 503,
        "gmail_oauth_failed",
        "Gmail OAuth token refresh failed",
      );
    }

    const token = await response.json() as TokenResponse;
    if (!token.access_token) {
      throw new GmailSourceError(
        503,
        "gmail_oauth_failed",
        "Gmail OAuth returned no access token",
      );
    }

    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now()
      + Math.max(30, (token.expires_in ?? 3600) - 60) * 1000;
    return token.access_token;
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    return this.refreshAccessToken();
  }

  private async get<T>(
    path: string,
    parameters?: URLSearchParams,
    retry = true,
  ): Promise<T> {
    const query = parameters && parameters.size > 0 ? `?${parameters}` : "";
    const response = await this.requestFetch(`${GMAIL_API_URL}${path}${query}`, {
      headers: { authorization: `Bearer ${await this.token()}` },
    });

    if (response.status === 401 && retry) {
      this.accessToken = undefined;
      return this.get<T>(path, parameters, false);
    }
    if (!response.ok) throw new GmailApiError(response.status);
    return await response.json() as T;
  }

  private userPath(suffix: string): string {
    return `/users/${encodeURIComponent(this.config.userId)}${suffix}`;
  }

  private static unavailable(error: unknown): never {
    if (error instanceof GmailSourceError) throw error;
    throw new GmailSourceError(
      503,
      "gmail_api_unavailable",
      error instanceof Error ? error.message : "Gmail API is unavailable",
    );
  }

  async getProfile(): Promise<{ historyId: string }> {
    try {
      return await this.get(this.userPath("/profile"));
    } catch (error) {
      return GoogleGmailClient.unavailable(error);
    }
  }

  async listMessages(pageToken?: string): Promise<GmailMessagesPage> {
    const parameters = new URLSearchParams({
      labelIds: this.config.labelId,
      maxResults: "100",
    });
    if (pageToken) parameters.set("pageToken", pageToken);

    try {
      return await this.get(this.userPath("/messages"), parameters);
    } catch (error) {
      return GoogleGmailClient.unavailable(error);
    }
  }

  async listHistory(
    startHistoryId: string,
    pageToken?: string,
  ): Promise<GmailHistoryPage> {
    const parameters = new URLSearchParams({
      startHistoryId,
      labelId: this.config.labelId,
      historyTypes: "messageAdded",
      maxResults: "100",
    });
    if (pageToken) parameters.set("pageToken", pageToken);

    try {
      return await this.get(this.userPath("/history"), parameters);
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) {
        throw new GmailHistoryExpiredError();
      }
      return GoogleGmailClient.unavailable(error);
    }
  }

  async getMessage(messageId: string): Promise<GmailMessage | null> {
    const parameters = new URLSearchParams({ format: "metadata" });
    parameters.append("metadataHeaders", "From");
    parameters.append("metadataHeaders", "Subject");

    try {
      return await this.get(
        this.userPath(`/messages/${encodeURIComponent(messageId)}`),
        parameters,
      );
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) return null;
      return GoogleGmailClient.unavailable(error);
    }
  }
}
