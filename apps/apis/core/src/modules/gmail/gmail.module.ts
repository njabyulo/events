import { eventsService } from "../events/events.module.js";
import { createGmailService, type GmailService } from "core/gmail";
import { GoogleGmailClient } from "../../integrations/gmail/gmail.client.js";
import { loadGmailConfig } from "../../integrations/gmail/gmail.config.js";
import { createGmailHandlers } from "./gmail.handlers.js";

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

export const gmailHandlers = createGmailHandlers(gmailService);
