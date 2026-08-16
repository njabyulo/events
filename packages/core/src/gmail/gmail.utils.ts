import type { EventEnvelope } from "../events/events.service.js";
import { GmailMessageError, type GmailMessage } from "./gmail.types.js";

export class GmailUtils {
  static normalizeMessage(message: GmailMessage): EventEnvelope {
    if (!message.id) {
      throw new GmailMessageError("Gmail message has no ID");
    }

    const internalDate = Number(message.internalDate);
    const occurredAt = new Date(internalDate);
    if (!Number.isFinite(internalDate) || Number.isNaN(occurredAt.getTime())) {
      throw new GmailMessageError("Gmail message has no timestamp");
    }

    const subject = GmailUtils.header(message, "subject") || "(no subject)";
    const actor = GmailUtils.senderAddress(GmailUtils.header(message, "from"));
    const labels = message.labelIds ?? [];

    return {
      source: "gmail",
      sourceEventId: message.id,
      type: "email.received",
      subject,
      actor,
      summary: subject,
      occurredAt: occurredAt.toISOString(),
      detail: {
        threadId: message.threadId ?? null,
        labels,
        snippet: message.snippet ?? "",
      },
      attributes: { labels },
      links: message.threadId
        ? [{ kind: "thread_id", value: message.threadId }]
        : [],
    };
  }

  private static header(message: GmailMessage, name: string): string | undefined {
    return message.payload?.headers?.find(
      (item) => item.name?.toLowerCase() === name.toLowerCase(),
    )?.value?.trim();
  }

  private static senderAddress(value: string | undefined): string | null {
    if (!value) return null;
    const bracketedAddress = value.match(/<([^<>]+)>/)?.[1]?.trim();
    return bracketedAddress || value.trim();
  }
}
