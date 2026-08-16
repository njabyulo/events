import type {
  EventEnvelope,
  IngestEventResult,
} from "../events/events.service.js";
import { GmailUtils } from "./gmail.utils.js";
import {
  GmailHistoryExpiredError,
  type GmailClient,
} from "./gmail.types.js";

export interface GmailEventsService {
  ingestEvent(event: EventEnvelope): Promise<IngestEventResult>;
  getSourceCursor(source: string, key: string): Promise<string | null>;
  setSourceCursor(source: string, key: string, cursor: string): Promise<void>;
}

export type GmailPollResult = {
  mode: "full" | "history";
  discovered: number;
  inserted: number;
  duplicates: number;
  historyId: string;
};

export type GmailServiceDependencies = {
  client: GmailClient;
  eventsService: GmailEventsService;
  source: { labelId: string; userId: string };
};

export class GmailService {
  private activePoll?: Promise<GmailPollResult>;

  constructor(private readonly dependencies: GmailServiceDependencies) {}

  poll(): Promise<GmailPollResult> {
    if (this.activePoll) return this.activePoll;

    this.activePoll = this.runPoll().finally(() => {
      this.activePoll = undefined;
    });
    return this.activePoll;
  }

  private cursorKey(): string {
    return `${this.dependencies.source.userId}:${this.dependencies.source.labelId}`;
  }

  private async runPoll(): Promise<GmailPollResult> {
    const cursor = await this.dependencies.eventsService.getSourceCursor(
      "gmail",
      this.cursorKey(),
    );

    if (!cursor) return this.fullSync();

    try {
      return await this.historySync(cursor);
    } catch (error) {
      if (error instanceof GmailHistoryExpiredError) return this.fullSync();
      throw error;
    }
  }

  private async ingestMessages(
    messageIds: Set<string>,
  ): Promise<Pick<GmailPollResult, "discovered" | "inserted" | "duplicates">> {
    let inserted = 0;
    let duplicates = 0;

    for (const messageId of messageIds) {
      const message = await this.dependencies.client.getMessage(messageId);
      if (!message) continue;

      const result = await this.dependencies.eventsService.ingestEvent(
        GmailUtils.normalizeMessage(message),
      );
      if (result.inserted) inserted += 1;
      else duplicates += 1;
    }

    return { discovered: messageIds.size, inserted, duplicates };
  }

  private async fullSync(): Promise<GmailPollResult> {
    const profile = await this.dependencies.client.getProfile();
    const messageIds = new Set<string>();
    let pageToken: string | undefined;

    do {
      const page = await this.dependencies.client.listMessages(pageToken);
      for (const message of page.messages ?? []) {
        if (message.id) messageIds.add(message.id);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    const counts = await this.ingestMessages(messageIds);
    await this.dependencies.eventsService.setSourceCursor(
      "gmail",
      this.cursorKey(),
      profile.historyId,
    );

    return { mode: "full", historyId: profile.historyId, ...counts };
  }

  private async historySync(startHistoryId: string): Promise<GmailPollResult> {
    const messageIds = new Set<string>();
    let pageToken: string | undefined;
    let nextHistoryId = startHistoryId;

    do {
      const page = await this.dependencies.client.listHistory(startHistoryId, pageToken);
      for (const history of page.history ?? []) {
        for (const added of history.messagesAdded ?? []) {
          if (added.message?.id) messageIds.add(added.message.id);
        }
      }
      if (page.historyId) nextHistoryId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);

    const counts = await this.ingestMessages(messageIds);
    await this.dependencies.eventsService.setSourceCursor(
      "gmail",
      this.cursorKey(),
      nextHistoryId,
    );

    return { mode: "history", historyId: nextHistoryId, ...counts };
  }
}

export const createGmailService = (
  dependencies: GmailServiceDependencies,
): GmailService => new GmailService(dependencies);
