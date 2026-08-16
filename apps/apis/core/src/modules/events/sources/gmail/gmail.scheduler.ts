import { gmailService } from "./gmail.dependencies.js";
import { isGmailPollingEnabled, loadGmailConfig } from "./gmail.config.js";

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
