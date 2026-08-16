export type GmailHeader = {
  name?: string;
  value?: string;
};

export type GmailMessage = {
  id?: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
};

export type GmailHistory = {
  messagesAdded?: Array<{ message?: GmailMessage }>;
};

export type GmailMessagesPage = {
  messages?: GmailMessage[];
  nextPageToken?: string;
};

export type GmailHistoryPage = {
  history?: GmailHistory[];
  historyId?: string;
  nextPageToken?: string;
};

export interface GmailClient {
  getProfile(): Promise<{ historyId: string }>;
  listMessages(pageToken?: string): Promise<GmailMessagesPage>;
  listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage>;
  getMessage(messageId: string): Promise<GmailMessage | null>;
}

export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail history cursor has expired");
    this.name = "GmailHistoryExpiredError";
  }
}

export class GmailMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailMessageError";
  }
}
