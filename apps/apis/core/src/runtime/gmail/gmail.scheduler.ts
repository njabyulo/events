import { gmailService } from "../../modules/gmail/gmail.module.js";
import { isGmailPollingEnabled, loadGmailConfig } from "../../integrations/gmail/gmail.config.js";

export function startGmailPollScheduler(): (() => void) | undefined {
  if (!isGmailPollingEnabled()) {
    console.log("Gmail polling disabled; configure Gmail environment variables to enable it");
    return undefined;
  }

  const config = loadGmailConfig();
  const run = () => {
    gmailService().poll().then((result) => {
      console.log("Gmail poll completed", result);
    }).catch((error) => {
      console.error("Gmail poll failed", error);
    });
  };

  run();
  const timer = setInterval(run, config.pollIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
