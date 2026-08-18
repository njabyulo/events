import { escalationsConfig } from "../../modules/escalations/escalations.config.js";
import { escalationsService } from "../../modules/escalations/escalations.module.js";

export class EscalationsScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private activeRun?: Promise<void>;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.requestRun(), escalationsConfig.pollIntervalMs);
    this.timer.unref?.();
    this.requestRun();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeRun;
  }

  private requestRun(): void {
    if (this.activeRun) return;
    this.activeRun = this.run().finally(() => {
      this.activeRun = undefined;
    });
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
