import type { StoredEvent } from "database/events";

export type TelegramAction = {
  label: string;
  value: string;
};

export type TelegramMessage = {
  text: string;
  actions: TelegramAction[];
};

export interface TelegramClient {
  sendMessage(message: TelegramMessage): Promise<{ messageId: string }>;
}

export type TelegramDelivery = {
  messageId: string;
  eventId: string;
  event: StoredEvent;
};
