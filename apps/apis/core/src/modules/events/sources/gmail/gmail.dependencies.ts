import { eventsService } from "../../events.dependencies.js";
import { createGmailService, type GmailService } from "core/gmail";
import { GoogleGmailClient } from "./gmail.client.js";
import { loadGmailConfig } from "./gmail.config.js";

let service: GmailService | undefined;

export function gmailService(): GmailService {
  if (service) return service;

  const config = loadGmailConfig();
  service = createGmailService({
    client: new GoogleGmailClient(config),
    eventsService,
    source: config,
  });
  return service;
}
