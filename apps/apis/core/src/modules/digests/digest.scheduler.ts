import { digestConfig } from "./digest.config.js";
import { digestService } from "./digest.dependencies.js";

export type DigestSchedulerDependencies = {
  flushDueQueues: () => Promise<unknown>;
  pollIntervalMs: number;
};

export class DigestScheduler {
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly dependencies: DigestSchedulerDependencies) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<void> {
    await this.dependencies.flushDueQueues();
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch (error) {
        console.error("Digest flush failed", error);
      } finally {
        this.schedule(this.dependencies.pollIntervalMs);
      }
    }, delayMs);
    this.timer.unref?.();
  }
}

export const digestScheduler = new DigestScheduler({
  flushDueQueues: () => digestService.flushDueQueues(),
  pollIntervalMs: digestConfig.pollIntervalMs,
});

export function startDigestScheduler(): void {
  if (digestConfig.enabled) digestScheduler.start();
}
