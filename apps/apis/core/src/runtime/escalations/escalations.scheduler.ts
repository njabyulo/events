import { escalationsConfig } from "../../modules/escalations/escalations.config.js";
import { escalationsService } from "../../modules/escalations/escalations.module.js";

export class EscalationsScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.run(), escalationsConfig.pollIntervalMs);
    this.timer.unref?.();
    void this.run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await escalationsService.drain();
    } catch (error) {
      console.error("Escalation worker failed", error);
    } finally {
      this.running = false;
    }
  }
}

export const escalationsScheduler = new EscalationsScheduler();

export function startEscalationsScheduler(): void {
  if (escalationsConfig.enabled) escalationsScheduler.start();
}
