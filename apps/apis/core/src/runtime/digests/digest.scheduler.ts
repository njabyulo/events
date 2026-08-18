import { digestConfig } from "../../modules/digests/digest.config.js";
import { digestService } from "../../modules/digests/digest.module.js";
import { withDatabaseAdvisoryLock } from "database/runtime";

export type DigestSchedulerDependencies = {
  flushDueQueues: () => Promise<unknown>;
  pollIntervalMs: number;
};

export class DigestScheduler {
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private activeRun?: Promise<void>;

  constructor(private readonly dependencies: DigestSchedulerDependencies) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.activeRun;
  }

  async runOnce(): Promise<void> {
    await withDatabaseAdvisoryLock("digest-scheduler", async () => {
      await this.dependencies.flushDueQueues();
    });
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      this.activeRun = this.execute();
      try {
        await this.activeRun;
      } finally {
        this.activeRun = undefined;
        this.schedule(this.dependencies.pollIntervalMs);
      }
    }, delayMs);
    this.timer.unref?.();
  }

  private async execute(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      console.error("Digest flush failed", error);
    }
  }
}

export const digestScheduler = new DigestScheduler({
  flushDueQueues: () => digestService.flushDueQueues(),
  pollIntervalMs: digestConfig.pollIntervalMs,
});

export function startDigestScheduler(): void {
  if (digestConfig.enabled) digestScheduler.start();
}
