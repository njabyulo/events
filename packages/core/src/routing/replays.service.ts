import type {
  ReplayRecord,
  RoutingRepo,
} from "database/routing";
import {
  RoutingNotFoundError,
  RoutingStoreUnavailableError,
} from "./routing.errors.js";
import { ReplaysUtils } from "./replays.utils.js";
import type { RouterService } from "./router.service.js";

export type CreateReplayCommand = {
  requestedBy: unknown;
  reason: unknown;
  eventFilter: unknown;
  ruleId: unknown;
  ruleVersion: unknown;
};

export type ReplaysRepository = Pick<
  RoutingRepo,
  | "createReplay"
  | "getReplay"
  | "listReplays"
  | "setReplayStatus"
  | "loadReplayEvents"
  | "loadReplayRules"
  | "commitReplayEvent"
>;

export type ReplaysServiceDependencies = {
  routingRepository: ReplaysRepository;
  routerService: Pick<RouterService, "decide">;
};

export class ReplaysService {
  constructor(private readonly dependencies: ReplaysServiceDependencies) {}

  async listReplays(): Promise<ReplayRecord[]> {
    return this.run(() => this.dependencies.routingRepository.listReplays());
  }

  async getReplay(id: string): Promise<ReplayRecord> {
    const replay = await this.run(() => this.dependencies.routingRepository.getReplay(id));
    if (!replay) throw new RoutingNotFoundError("replay_not_found", "Replay does not exist");
    return replay;
  }

  async createReplay(command: CreateReplayCommand): Promise<ReplayRecord> {
    const requestedBy = ReplaysUtils.requiredText(command.requestedBy, "requested_by", 320);
    const reason = ReplaysUtils.requiredText(command.reason, "reason", 1_000);
    const eventFilter = ReplaysUtils.normalizeFilter(command.eventFilter);
    const ruleId = ReplaysUtils.positiveId(command.ruleId, "rule_id");
    const ruleVersion = ReplaysUtils.positiveVersion(command.ruleVersion);
    const rules = await this.run(
      () => this.dependencies.routingRepository.loadReplayRules(ruleId, ruleVersion),
    );
    if (rules.length !== 1 || rules[0]?.version !== ruleVersion) {
      throw new RoutingNotFoundError(
        "rule_version_not_found",
        "Pinned rule version does not exist",
      );
    }

    const replay = await this.run(() => this.dependencies.routingRepository.createReplay({
      requestedBy,
      reason,
      eventFilter,
      ruleId,
      ruleVersion,
    }));

    try {
      await this.dependencies.routingRepository.setReplayStatus(replay.id, "running");
      const events = await this.dependencies.routingRepository.loadReplayEvents(eventFilter);
      for (const event of events) {
        const decisions = this.dependencies.routerService.decide(event, rules);
        if (decisions.length === 0) continue;
        await this.dependencies.routingRepository.commitReplayEvent(
          replay.id,
          event.id,
          decisions,
        );
      }
      await this.dependencies.routingRepository.setReplayStatus(
        replay.id,
        "completed",
        events.length,
      );
      return await this.getReplay(replay.id);
    } catch (error) {
      await this.dependencies.routingRepository.setReplayStatus(replay.id, "failed")
        .catch(() => undefined);
      if (error instanceof RoutingNotFoundError) throw error;
      throw new RoutingStoreUnavailableError(error);
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RoutingNotFoundError) throw error;
      throw new RoutingStoreUnavailableError(error);
    }
  }
}

export const createReplaysService = (
  dependencies: ReplaysServiceDependencies,
): ReplaysService => new ReplaysService(dependencies);
