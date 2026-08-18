import { replaysService } from "../../modules/routing/routing.module.js";
import { routerRuntimeConfig } from "./router.config.js";

export type ReplayEngineDependencies = {
  pollIntervalMs: number;
  drain: () => Promise<{
    status: "idle" | "batch_committed" | "lease_lost" | "failed";
    error?: Error;
  }[]>;
};

export class ReplayEngine {
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private activeRun?: Promise<void>;

  constructor(private readonly dependencies: ReplayEngineDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.activeRun;
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    this.timer = setTimeout(() => {
      this.activeRun = this.run().finally(() => {
        this.activeRun = undefined;
        this.schedule(this.dependencies.pollIntervalMs);
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private async run(): Promise<void> {
    try {
      const results = await this.dependencies.drain();
      const failed = results.find((result) => result.status === "failed");
      if (failed?.error) console.error("Replay batch failed", failed.error);
    } catch (error) {
      console.error("Replay worker failed", error);
    }
  }
}

export const replayEngine = new ReplayEngine({
  pollIntervalMs: routerRuntimeConfig.pollIntervalMs,
  drain: () => replaysService.drain(),
});

export function startReplayEngine(): void {
  if (routerRuntimeConfig.enabled) replayEngine.start();
}
