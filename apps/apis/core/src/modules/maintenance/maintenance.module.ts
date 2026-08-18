import { createMaintenanceService } from "core/maintenance";
import { queuesRepo } from "database/queues";
import { streamsRepo } from "database/triage";
import { maintenanceConfig } from "./maintenance.config.js";

export const maintenanceService = createMaintenanceService({
  queuesRepository: queuesRepo,
  streamsRepository: streamsRepo,
  batchSize: maintenanceConfig.batchSize,
  streamRetentionSeconds: maintenanceConfig.streamRetentionSeconds,
});
