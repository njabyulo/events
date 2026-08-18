import { maintenanceConfig } from "../../modules/maintenance/maintenance.config.js";
import { maintenanceService } from "../../modules/maintenance/maintenance.module.js";
import { withDatabaseAdvisoryLock } from "database/runtime";

export class MaintenanceScheduler {
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private activeRun?: Promise<void>;

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
      this.activeRun = withDatabaseAdvisoryLock("maintenance", () => (
        maintenanceService.runOnce()
      )).then((locked) => {
          if (!locked.acquired) return;
          const result = locked.value;
          const changed = Math.max(result.deadLettered, result.expiredQueueMessages)
            + result.prunedStreamMessages;
          if (changed > 0) console.log("Maintenance completed", result);
        })
        .catch((error) => console.error("Maintenance failed", error))
        .finally(() => {
          this.activeRun = undefined;
          this.schedule(maintenanceConfig.pollIntervalMs);
        });
    }, delayMs);
    this.timer.unref?.();
  }
}

export const maintenanceScheduler = new MaintenanceScheduler();

export function startMaintenanceScheduler(): void {
  if (maintenanceConfig.enabled) maintenanceScheduler.start();
}
