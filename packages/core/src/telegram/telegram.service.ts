import type { StoredEvent } from "database/events";
import type { TelegramClient, TelegramDelivery } from "./telegram.types.js";
import { TelegramUtils } from "./telegram.utils.js";

export class TelegramService {
  constructor(private readonly client: TelegramClient) {}

  async deliver(event: StoredEvent): Promise<TelegramDelivery> {
    const sent = await this.client.sendMessage(TelegramUtils.message(event));
    return { messageId: sent.messageId, eventId: event.id, event };
  }
}

export const createTelegramService = (client: TelegramClient): TelegramService => (
  new TelegramService(client)
);
