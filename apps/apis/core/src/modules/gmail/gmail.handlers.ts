import type { GmailService } from "core/gmail";

type GmailPollingPort = Pick<GmailService, "poll">;

export class GmailHandlers {
  constructor(private readonly resolveService: () => GmailPollingPort) {}

  poll() {
    return this.resolveService().poll();
  }
}

export const createGmailHandlers = (
  resolveService: () => GmailPollingPort,
): GmailHandlers => new GmailHandlers(resolveService);
