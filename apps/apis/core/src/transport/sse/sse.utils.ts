export type SseMessage = {
  id: string;
  eventName: string;
};

export type SseFrame = {
  id: string;
  event: string;
  data: string;
  skipped: boolean;
};

export class SseUtils {
  static cursor(value: string | undefined): string {
    if (!value || !/^\d{1,19}$/.test(value)) return "0";
    const id = BigInt(value);
    return id <= 9_223_372_036_854_775_807n ? String(id) : "0";
  }

  static frame<TMessage extends SseMessage>(message: TMessage, maximumBytes: number): SseFrame {
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) <= maximumBytes) {
      return {
        id: message.id,
        event: message.eventName,
        data,
        skipped: false,
      };
    }

    return {
      id: message.id,
      event: "stream.message.skipped",
      data: JSON.stringify({
        streamMessageId: message.id,
        originalEventName: message.eventName,
        reason: "frame_too_large",
        refresh: true,
      }),
      skipped: true,
    };
  }
}
