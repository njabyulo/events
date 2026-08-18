import type { QueuesRepo } from "database/queues";
import type { StreamsRepo } from "database/triage";

export type MaintenanceServiceDependencies = {
  queuesRepository: Pick<QueuesRepo, "runMaintenance">;
  streamsRepository: Pick<StreamsRepo, "pruneMessages">;
  batchSize?: number;
  streamRetentionSeconds?: number;
};

export type MaintenanceResult = {
  deadLettered: number;
  expiredQueueMessages: number;
  prunedStreamMessages: number;
};

export class MaintenanceService {
  private readonly batchSize: number;
  private readonly streamRetentionSeconds: number;

  constructor(private readonly dependencies: MaintenanceServiceDependencies) {
    this.batchSize = dependencies.batchSize ?? 100;
    this.streamRetentionSeconds = dependencies.streamRetentionSeconds ?? 604_800;
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 1_000) {
      throw new RangeError("Maintenance batch size must be between 1 and 1000");
    }
    if (!Number.isSafeInteger(this.streamRetentionSeconds) || this.streamRetentionSeconds < 1) {
      throw new RangeError("Stream retention must be a positive integer");
    }
  }

  async runOnce(): Promise<MaintenanceResult> {
    const [queues, prunedStreamMessages] = await Promise.all([
      this.dependencies.queuesRepository.runMaintenance(this.batchSize),
      this.dependencies.streamsRepository.pruneMessages(
        this.streamRetentionSeconds,
        this.batchSize,
      ),
    ]);
    return {
      deadLettered: queues.deadLettered,
      expiredQueueMessages: queues.expired,
      prunedStreamMessages,
    };
  }
}

export const createMaintenanceService = (
  dependencies: MaintenanceServiceDependencies,
): MaintenanceService => new MaintenanceService(dependencies);
