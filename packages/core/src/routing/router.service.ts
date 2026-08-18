import type {
  ClaimedRoutingWork,
  CommitRoutingResult,
  EventRouteRecord,
  EventRoutingSkipRecord,
  RoutingDecision,
  RoutingRepo,
  RuleSnapshot,
  StoredEvent,
  TargetSnapshot,
} from "database/routing";
import { RoutingPatternError, RoutingUtils, type RoutingScheduleConfig } from "./routing.utils.js";
import { RoutingStoreUnavailableError } from "./routing.errors.js";
import { TargetsUtils } from "./targets.utils.js";
import {
  createTargetDispatchers,
  type TargetDispatcher,
} from "./dispatchers/target.dispatcher.js";
import { DatabaseIds } from "../shared/database-ids.js";

export type RouterRepository = Pick<
  RoutingRepo,
  | "claimNext"
  | "renewLease"
  | "fail"
  | "commit"
  | "markRuleInvalid"
  | "getEventRoutes"
  | "getEventRoutingSkips"
>;

export type RouterServiceDependencies = {
  routingRepository: RouterRepository;
  schedule: RoutingScheduleConfig;
  clock: () => Date;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxAttempts: number;
  targetDispatchers: TargetDispatcher[];
};

export type RouterRunResult =
  | { status: "idle" }
  | ({ status: "committed"; eventId: string } & CommitRoutingResult)
  | { status: "lease_lost"; eventId: string }
  | { status: "dead"; eventId: string; error: Error }
  | { status: "failed"; eventId: string | null; error: Error };

class InvalidStoredRuleError extends Error {
  constructor(
    readonly ruleId: string,
    readonly ruleVersion: number,
    cause: RoutingPatternError,
  ) {
    super(`Rule ${ruleId} has an invalid pattern: ${cause.message}`);
    this.name = "InvalidStoredRuleError";
  }
}

export class RouterService {
  constructor(private readonly dependencies: RouterServiceDependencies) {}

  async runOnce(): Promise<RouterRunResult> {
    let work: ClaimedRoutingWork | null = null;
    try {
      work = await this.dependencies.routingRepository.claimNext(this.dependencies.leaseMs);
      if (!work) return { status: "idle" };

      const renewal = this.startLeaseRenewal(work);
      try {
        const decisions = this.decide(work.event, work.rules, work.defaultRule);
        const committed = await this.dependencies.routingRepository.commit(
          work.event.id,
          work.leaseToken,
          decisions,
        );
        if (!committed.committed) {
          return { status: "lease_lost", eventId: work.event.id };
        }
        return { status: "committed", eventId: work.event.id, ...committed };
      } finally {
        clearInterval(renewal);
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (!work) return { status: "failed", eventId: null, error: normalized };

      if (error instanceof InvalidStoredRuleError) {
        await this.dependencies.routingRepository.markRuleInvalid(
          error.ruleId,
          error.ruleVersion,
          error.message,
        )
          .catch(() => undefined);
      }
      const delay = Math.min(
        this.dependencies.retryMaxMs,
        this.dependencies.retryBaseMs * (2 ** Math.max(0, work.attempts - 1)),
      );
      const failed = await this.dependencies.routingRepository.fail(
        work.event.id,
        work.leaseToken,
        normalized.message,
        delay,
        this.dependencies.maxAttempts,
      ).catch(() => "lease_lost" as const);
      if (failed === "dead") {
        return { status: "dead", eventId: work.event.id, error: normalized };
      }
      return { status: "failed", eventId: work.event.id, error: normalized };
    }
  }

  async drain(maxItems = 1_000): Promise<RouterRunResult[]> {
    const results: RouterRunResult[] = [];
    for (let processed = 0; processed < maxItems; processed += 1) {
      const result = await this.runOnce();
      results.push(result);
      if (result.status === "idle" || result.status === "failed") break;
    }
    return results;
  }

  async getEventRoutes(eventId: string): Promise<EventRouteRecord[]> {
    if (!DatabaseIds.isValid(eventId)) return [];
    try {
      const routes = await this.dependencies.routingRepository.getEventRoutes(eventId);
      return routes.map((route) => ({
        ...route,
        targetConfig: TargetsUtils.publicConfig(route.targetConfig),
      }));
    } catch (error) {
      throw new RoutingStoreUnavailableError(error);
    }
  }

  async getEventRouting(eventId: string): Promise<{
    routes: EventRouteRecord[];
    skips: EventRoutingSkipRecord[];
  }> {
    if (!DatabaseIds.isValid(eventId)) {
      return { routes: [], skips: [] };
    }
    try {
      const [routes, skips] = await Promise.all([
        this.getEventRoutes(eventId),
        this.dependencies.routingRepository.getEventRoutingSkips(eventId),
      ]);
      return { routes, skips };
    } catch (error) {
      if (error instanceof RoutingStoreUnavailableError) throw error;
      throw new RoutingStoreUnavailableError(error);
    }
  }

  decide(
    event: StoredEvent,
    rules: RuleSnapshot[],
    defaultRule?: RuleSnapshot,
  ): RoutingDecision[] {
    const decisions: RoutingDecision[] = [];
    let matched = false;
    const now = this.dependencies.clock();

    for (const rule of rules) {
      let ruleMatches: boolean;
      try {
        ruleMatches = RoutingUtils.matches(rule.pattern, event);
      } catch (error) {
        if (error instanceof RoutingPatternError) {
          throw new InvalidStoredRuleError(rule.id, rule.version, error);
        }
        throw error;
      }
      if (!ruleMatches) continue;
      matched = true;
      for (const target of rule.targets) {
        decisions.push(this.toDecision(rule, target, now));
      }
    }

    if (!matched && defaultRule) {
      for (const target of defaultRule.targets) {
        decisions.push(this.toDecision(defaultRule, target, now));
      }
    }
    return decisions;
  }

  private toDecision(
    rule: RuleSnapshot,
    target: TargetSnapshot,
    now: Date,
  ): RoutingDecision {
    return {
      ruleId: rule.id,
      ruleVersion: rule.version,
      rulePattern: rule.pattern,
      priority: rule.priority,
      target,
      delivery: this.deliveryFor(target, rule.priority, now),
    };
  }

  private deliveryFor(
    target: TargetSnapshot,
    priority: RuleSnapshot["priority"],
    now: Date,
  ): RoutingDecision["delivery"] {
    if (!target.enabled || target.deletedAt !== null) {
      return {
        kind: "skipped",
        reason: target.deletedAt === null ? "target_disabled" : "target_deleted",
      };
    }
    const dispatcher = this.dependencies.targetDispatchers.find(
      (candidate) => candidate.supports(target.kind),
    );
    if (!dispatcher) throw new Error(`No dispatcher supports target kind ${target.kind}`);
    return dispatcher.createDelivery(target, priority, now);
  }

  private startLeaseRenewal(work: ClaimedRoutingWork): ReturnType<typeof setInterval> {
    const intervalMs = Math.max(100, Math.floor(this.dependencies.leaseMs / 3));
    const timer = setInterval(() => {
      void this.dependencies.routingRepository.renewLease(
        work.event.id,
        work.leaseToken,
        this.dependencies.leaseMs,
      ).catch(() => undefined);
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}

export const createRouterService = (
  dependencies: Pick<RouterServiceDependencies, "routingRepository">
    & Partial<Omit<RouterServiceDependencies, "routingRepository">>,
): RouterService => {
  const schedule = dependencies.schedule ?? {
    timeZone: "Africa/Johannesburg",
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
  };
  return new RouterService({
    routingRepository: dependencies.routingRepository,
    schedule,
    clock: dependencies.clock ?? (() => new Date()),
    leaseMs: dependencies.leaseMs ?? 30_000,
    retryBaseMs: dependencies.retryBaseMs ?? 1_000,
    retryMaxMs: dependencies.retryMaxMs ?? 60_000,
    maxAttempts: dependencies.maxAttempts ?? 10,
    targetDispatchers: dependencies.targetDispatchers ?? createTargetDispatchers(schedule),
  });
};
