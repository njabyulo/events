import type {
  ClaimedReplay,
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
  | "claimReplay"
  | "loadReplayEvents"
  | "loadReplayRules"
  | "commitReplayBatch"
  | "failReplay"
>;

export type ReplaysServiceDependencies = {
  routingRepository: ReplaysRepository;
  routerService: Pick<RouterService, "decide">;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  retryDelaySeconds?: number;
};

export type ReplayRunResult =
  | { status: "idle" }
  | { status: "batch_committed"; replayId: string; eventCount: number; completed: boolean }
  | { status: "lease_lost"; replayId: string }
  | { status: "failed"; replayId: string | null; error: Error };

export class ReplaysService {
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly maxAttempts: number;
  private readonly retryDelaySeconds: number;

  constructor(private readonly dependencies: ReplaysServiceDependencies) {
    this.batchSize = ReplaysService.positiveInteger(dependencies.batchSize, 100, 1_000);
    this.leaseSeconds = ReplaysService.positiveInteger(dependencies.leaseSeconds, 60, 3_600);
    this.maxAttempts = ReplaysService.positiveInteger(dependencies.maxAttempts, 5, 100);
    this.retryDelaySeconds = ReplaysService.positiveInteger(
      dependencies.retryDelaySeconds,
      5,
      3_600,
    );
  }

  async listReplays(
    limitValue: unknown = 100,
    beforeId?: unknown,
  ): Promise<ReplayRecord[]> {
    const limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      throw new RangeError("Replay limit must be from 1 to 250");
    }
    const cursor = beforeId === undefined
      ? undefined
      : ReplaysUtils.positiveId(beforeId, "before_id");
    return this.run(() => this.dependencies.routingRepository.listReplays(limit, cursor));
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

    return this.run(() => this.dependencies.routingRepository.createReplay({
      requestedBy,
      reason,
      eventFilter,
      ruleId,
      ruleVersion,
    }));
  }

  async runOnce(): Promise<ReplayRunResult> {
    let replay: ClaimedReplay | null = null;
    try {
      replay = await this.dependencies.routingRepository.claimReplay(this.leaseSeconds);
      if (!replay) return { status: "idle" };

      const rules = await this.dependencies.routingRepository.loadReplayRules(
        replay.ruleId,
        replay.ruleVersion,
      );
      if (rules.length === 0) throw new Error("Replay rule version is unavailable");

      const events = await this.dependencies.routingRepository.loadReplayEvents(
        replay.eventFilter,
        replay.lastEventId ?? "0",
        this.batchSize,
      );
      const completed = events.length < this.batchSize;
      const committed = await this.dependencies.routingRepository.commitReplayBatch(
        replay.id,
        replay.leaseToken,
        events.map((event) => ({
          eventId: event.id,
          decisions: this.dependencies.routerService.decide(event, rules),
        })),
        completed,
      );
      if (!committed) return { status: "lease_lost", replayId: replay.id };
      return {
        status: "batch_committed",
        replayId: replay.id,
        eventCount: events.length,
        completed,
      };
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (replay) {
        await this.dependencies.routingRepository.failReplay(
          replay.id,
          replay.leaseToken,
          normalized.message,
          this.retryDelaySeconds,
          this.maxAttempts,
        ).catch(() => false);
      }
      return { status: "failed", replayId: replay?.id ?? null, error: normalized };
    }
  }

  async drain(maxBatches = 10): Promise<ReplayRunResult[]> {
    const results: ReplayRunResult[] = [];
    for (let processed = 0; processed < maxBatches; processed += 1) {
      const result = await this.runOnce();
      results.push(result);
      if (result.status === "idle" || result.status === "failed") break;
    }
    return results;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RoutingNotFoundError) throw error;
      throw new RoutingStoreUnavailableError(error);
    }
  }

  private static positiveInteger(
    value: number | undefined,
    fallback: number,
    maximum: number,
  ): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
      throw new RangeError(`Replay configuration must be an integer from 1 to ${maximum}`);
    }
    return resolved;
  }
}

export const createReplaysService = (
  dependencies: ReplaysServiceDependencies,
): ReplaysService => new ReplaysService(dependencies);
