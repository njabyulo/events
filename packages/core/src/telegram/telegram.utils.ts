import type { StoredEvent } from "database/events";
import type { TelegramAction, TelegramMessage } from "./telegram.types.js";

export class TelegramUtils {
  static message(event: StoredEvent): TelegramMessage {
    const priority = typeof event.attributes.priority === "string"
      ? event.attributes.priority.toUpperCase()
      : "NORMAL";
    const domain = typeof event.attributes.domain === "string"
      ? event.attributes.domain
      : "unclassified";
    const summary = (event.summary || event.type).replace(/\s+/g, " ").trim().slice(0, 1_000);
    return {
      text: `[events] ${priority} · ${domain}\n${summary}`,
      actions: TelegramUtils.actions(event.attributes.actions, event.id),
    };
  }

  static actions(value: unknown, eventId: string): TelegramAction[] {
    if (!Array.isArray(value)) return [{ label: "Review", value: `event.review:${eventId}` }];
    const actions = value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const record = candidate as Record<string, unknown>;
      if (typeof record.label !== "string" || typeof record.value !== "string") return [];
      const label = record.label.trim().slice(0, 32);
      const action = TelegramUtils.truncateUtf8(record.value.trim(), 64);
      return label && action ? [{ label, value: action }] : [];
    });
    return actions.slice(0, 8);
  }

  private static truncateUtf8(value: string, maximumBytes: number): string {
    let result = "";
    let bytes = 0;
    for (const character of value) {
      const size = Buffer.byteLength(character);
      if (bytes + size > maximumBytes) break;
      result += character;
      bytes += size;
    }
    return result;
  }
}
