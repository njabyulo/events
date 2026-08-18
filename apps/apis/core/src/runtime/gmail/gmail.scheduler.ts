import { withDatabaseAdvisoryLock } from "database/runtime";
import { gmailService } from "../../modules/gmail/gmail.module.js";
import { isGmailPollingEnabled, loadGmailConfig } from "../../integrations/gmail/gmail.config.js";

export class GmailPollScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private activePoll?: Promise<void>;

  start(): void {
    if (this.timer) return;
    const config = loadGmailConfig();
    const run = () => {
      if (this.activePoll) return;
      this.activePoll = withDatabaseAdvisoryLock("gmail-poller", async () => {
        const result = await gmailService().poll();
        console.log("Gmail poll completed", result);
      }).then(() => undefined).catch((error) => {
        console.error("Gmail poll failed", error);
      }).finally(() => {
        this.activePoll = undefined;
      });
    };
    run();
    this.timer = setInterval(run, config.pollIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activePoll;
  }
}

export const gmailPollScheduler = new GmailPollScheduler();

export function startGmailPollScheduler(): void {
  if (!isGmailPollingEnabled()) {
    console.log("Gmail polling disabled; configure Gmail environment variables to enable it");
    return;
  }
  gmailPollScheduler.start();
}
