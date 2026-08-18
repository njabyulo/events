import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db, type Database } from "../../client.js";
import { eventLinksTable, eventsTable, outboxTable } from "../../schemas/events.schema.js";
import {
  adminActionsTable,
  eventRoutesTable,
  eventRoutingSkipsTable,
  queueMessagesTable,
  queuesTable,
  replaysTable,
  rulesTable,
  ruleTargetsTable,
  ruleVersionsTable,
  targetsTable,
} from "../../schemas/routing.schema.js";
import { streamMessagesTable } from "../../schemas/transport.schema.js";
import { escalationsTable } from "../../schemas/escalations.schema.js";
import { toStoredEvents } from "../events/events.mapper.js";
import type { StoredEvent } from "../events/events.types.js";
import { databaseId, requiredDatabaseId } from "../database-id.js";
import type {
  ClaimedRoutingWork,
  ClaimedReplay,
  CommitRoutingResult,
  EventRouteRecord,
  EventRoutingSkipRecord,
  Priority,
  QueueRecord,
  ReplayFilter,
  ReplayRecord,
  RoutingDecision,
  RuleSnapshot,
  TargetKind,
  TargetSnapshot,
} from "./routing.types.js";

const DEFAULT_RULE_NAME = "system.unclassified";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | DatabaseTransaction;
type QueueRow = typeof queuesTable.$inferSelect;

export type RoutingRepoDependencies = {
  database: Database;
  sseChannel: string;
  queueChannel: string;
  ruleCacheTtlMs: number;
};

export type CreateReplayInput = {
  requestedBy: string;
  reason: string;
  eventFilter: ReplayFilter;
  ruleId: string | null;
  ruleVersion: number | null;
};

function toQueue(row: QueueRow): QueueRecord {
  return {
    id: String(row.id),
    name: row.name,
    fifo: row.fifo,
    visibilityTimeoutSeconds: row.visibility_timeout_seconds,
    maxReceiveCount: row.max_receive_count,
    retentionSeconds: row.retention_seconds,
    escalate: row.escalate,
    quietHours: row.quiet_hours,
    digestFlushCron: row.digest_flush_cron,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

function toReplay(row: typeof replaysTable.$inferSelect): ReplayRecord {
  return {
    id: String(row.id),
    requestedBy: row.requested_by,
    reason: row.reason,
    eventFilter: row.event_filter as ReplayFilter,
    ruleId: row.rule_id === null ? null : String(row.rule_id),
    ruleVersion: row.rule_version,
    status: row.status as ReplayRecord["status"],
    eventsMatched: row.events_matched ?? 0,
    attempts: row.attempts,
    lastEventId: row.last_event_id === null ? null : String(row.last_event_id),
    lockedUntil: row.locked_until?.toISOString() ?? null,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export class RoutingRepo {
  private ruleCache?: { expiresAt: number; snapshots: RuleSnapshot[] };

  constructor(private readonly dependencies: RoutingRepoDependencies) {}

  private async loadCachedCurrentRules(executor: QueryExecutor): Promise<RuleSnapshot[]> {
    if (this.ruleCache && this.ruleCache.expiresAt > Date.now()) {
      return this.ruleCache.snapshots;
    }
    const snapshots = await this.loadCurrentRuleSnapshots(executor, and(
      isNull(rulesTable.deleted_at),
      or(
        eq(rulesTable.name, DEFAULT_RULE_NAME),
        and(
          ne(rulesTable.name, DEFAULT_RULE_NAME),
          eq(rulesTable.enabled, true),
        ),
      ),
    ));
    this.ruleCache = {
      expiresAt: Date.now() + this.dependencies.ruleCacheTtlMs,
      snapshots,
    };
    return snapshots;
  }

  private async loadEvent(
    executor: QueryExecutor,
    eventId: bigint,
  ): Promise<StoredEvent> {
    const rows = await executor
      .select({ event: eventsTable, link: eventLinksTable })
      .from(eventsTable)
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(eq(eventsTable.id, eventId));
    const event = toStoredEvents(rows)[0];
    if (!event) throw new Error(`Event ${eventId} does not exist`);
    return event;
  }

  private async loadRuleSnapshots(
    executor: QueryExecutor,
    where: SQL | undefined,
    versionCondition: SQL,
  ): Promise<RuleSnapshot[]> {
    const rows = await executor
      .select({
        rule: rulesTable,
        version: ruleVersionsTable,
        target: targetsTable,
        queue: queuesTable,
      })
      .from(rulesTable)
      .innerJoin(ruleVersionsTable, and(
        eq(ruleVersionsTable.rule_id, rulesTable.id),
        versionCondition,
      ))
      .leftJoin(ruleTargetsTable, eq(ruleTargetsTable.rule_id, rulesTable.id))
      .leftJoin(targetsTable, eq(targetsTable.id, ruleTargetsTable.target_id))
      .leftJoin(queuesTable, and(
        eq(targetsTable.kind, "queue"),
        sql`${queuesTable.id}::text = ${targetsTable.config}->>'queueId'`,
        isNull(queuesTable.deleted_at),
      ))
      .where(where)
      .orderBy(asc(rulesTable.id), asc(targetsTable.id));

    const snapshots = new Map<bigint, RuleSnapshot>();
    for (const { rule, version, target, queue } of rows) {
      const ruleSnapshot = snapshots.get(rule.id) ?? {
        id: String(rule.id),
        name: rule.name,
        version: version.version,
        pattern: version.pattern,
        priority: version.priority as Priority,
        targets: [],
      };
      if (!target) {
        snapshots.set(rule.id, ruleSnapshot);
        continue;
      }

      const targetSnapshot: TargetSnapshot = {
        id: String(target.id),
        name: target.name,
        kind: target.kind as TargetKind,
        config: target.config,
        enabled: target.enabled,
        createdAt: target.created_at.toISOString(),
        updatedAt: target.updated_at.toISOString(),
        deletedAt: target.deleted_at?.toISOString() ?? null,
        queue: queue ? toQueue(queue) : null,
      };
      ruleSnapshot.targets.push(targetSnapshot);
      snapshots.set(rule.id, ruleSnapshot);
    }

    return [...snapshots.values()];
  }

  private async loadCurrentRuleSnapshots(
    executor: QueryExecutor,
    where: SQL | undefined,
  ): Promise<RuleSnapshot[]> {
    return this.loadRuleSnapshots(
      executor,
      where,
      eq(ruleVersionsTable.version, rulesTable.current_version),
    );
  }

  async claimNext(visibilityTimeoutMs = 30_000): Promise<ClaimedRoutingWork | null> {
    if (!Number.isSafeInteger(visibilityTimeoutMs) || visibilityTimeoutMs < 1) {
      throw new RangeError("visibilityTimeoutMs must be a positive integer");
    }
    const leaseToken = randomUUID();

    return this.dependencies.database.transaction(async (transaction) => {
      const result = await transaction.execute(sql`
        with candidate as (
          select event_id
          from outbox
          where available_at <= now()
            and (
              status in ('pending', 'failed')
              or (status = 'processing' and locked_until <= now())
            )
          order by available_at, event_id
          for update skip locked
          limit 1
        )
        update outbox
        set status = 'processing',
            locked_until = now() + (${visibilityTimeoutMs} * interval '1 millisecond'),
            lease_token = ${leaseToken},
            attempts = attempts + 1,
            last_error = null
        from candidate
        where outbox.event_id = candidate.event_id
        returning outbox.event_id, outbox.attempts
      `);
      const claimed = result.rows[0];
      if (!claimed) return null;

      const eventId = BigInt(String(claimed.event_id));
      const ruleSnapshots = await this.loadCachedCurrentRules(transaction);
      const defaultRule = ruleSnapshots.find(({ name }) => name === DEFAULT_RULE_NAME);
      const rules = ruleSnapshots.filter(({ name }) => name !== DEFAULT_RULE_NAME);
      if (
        !defaultRule
        || defaultRule.targets.length !== 1
        || !defaultRule.targets[0]?.enabled
        || defaultRule.targets[0].deletedAt !== null
        || defaultRule.targets[0].kind !== "queue"
        || !defaultRule.targets[0].queue
      ) {
        throw new Error("System unclassified route is not configured");
      }

      return {
        event: await this.loadEvent(transaction, eventId),
        leaseToken,
        attempts: Number(claimed.attempts),
        rules,
        defaultRule,
      };
    });
  }

  async renewLease(
    eventId: string,
    leaseToken: string,
    visibilityTimeoutMs = 30_000,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(visibilityTimeoutMs) || visibilityTimeoutMs < 1) {
      throw new RangeError("visibilityTimeoutMs must be a positive integer");
    }
    const parsedEventId = databaseId(eventId);
    if (parsedEventId === null) return false;
    const [renewed] = await this.dependencies.database.update(outboxTable).set({
      locked_until: sql`now() + (${visibilityTimeoutMs} * interval '1 millisecond')`,
    }).where(and(
      eq(outboxTable.event_id, parsedEventId),
      eq(outboxTable.status, "processing"),
      eq(outboxTable.lease_token, leaseToken),
    )).returning({ eventId: outboxTable.event_id });
    return renewed !== undefined;
  }

  async fail(
    eventId: string,
    leaseToken: string,
    error: string,
    retryDelayMs: number,
    maxAttempts: number,
  ): Promise<"retry_scheduled" | "dead" | "lease_lost"> {
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
      throw new RangeError("retryDelayMs must be a non-negative integer");
    }
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError("maxAttempts must be a positive integer");
    }
    const parsedEventId = databaseId(eventId);
    if (parsedEventId === null) return "lease_lost";
    const [failed] = await this.dependencies.database.update(outboxTable).set({
      status: sql`case when ${outboxTable.attempts} >= ${maxAttempts}
        then 'dead' else 'failed' end`,
      available_at: sql`now() + (${retryDelayMs} * interval '1 millisecond')`,
      locked_until: null,
      lease_token: null,
      last_error: error.slice(0, 1_000),
      completed_at: sql`case when ${outboxTable.attempts} >= ${maxAttempts}
        then now() else null end`,
    }).where(and(
      eq(outboxTable.event_id, parsedEventId),
      eq(outboxTable.status, "processing"),
      eq(outboxTable.lease_token, leaseToken),
    )).returning({ status: outboxTable.status });
    if (!failed) return "lease_lost";
    return failed.status === "dead" ? "dead" : "retry_scheduled";
  }

  async markRuleInvalid(
    ruleId: string,
    ruleVersion: number,
    message: string,
  ): Promise<void> {
    const numericRuleId = databaseId(ruleId);
    if (numericRuleId === null) return;

    await this.dependencies.database.update(rulesTable).set({
      enabled: false,
      validation_error: message.slice(0, 1_000),
      invalid_at: new Date(),
      updated_at: new Date(),
    }).where(and(
      eq(rulesTable.id, numericRuleId),
      eq(rulesTable.current_version, ruleVersion),
      isNull(rulesTable.deleted_at),
    ));
  }

  private async createDeliveries(
    transaction: DatabaseTransaction,
    eventId: bigint,
    replayId: bigint | null,
    decisions: RoutingDecision[],
  ): Promise<Pick<
    CommitRoutingResult,
    "routesCreated" | "deliveriesCreated" | "skipsRecorded"
  >> {
    const deliveryDecisions = decisions.filter(
      (decision) => decision.delivery.kind !== "skipped",
    );
    const targetIds = [...new Set(
      deliveryDecisions.map((decision) => requiredDatabaseId(decision.target.id, "targetId")),
    )];
    const activeTargetIds = new Set<bigint>();
    if (targetIds.length > 0) {
      const activeTargets = await transaction
        .select({ id: targetsTable.id })
        .from(targetsTable)
        .where(and(
          inArray(targetsTable.id, targetIds),
          eq(targetsTable.enabled, true),
          isNull(targetsTable.deleted_at),
        ))
        .for("share");
      for (const target of activeTargets) activeTargetIds.add(target.id);
    }

    const skippedDecisions = decisions.flatMap((decision) => {
      if (decision.delivery.kind === "skipped") {
        return [{ decision, reason: decision.delivery.reason }];
      }
      return activeTargetIds.has(requiredDatabaseId(decision.target.id, "targetId"))
        ? []
        : [{ decision, reason: "target_disabled_during_routing" }];
    });
    const activeDecisions = deliveryDecisions.filter(
      (decision) => activeTargetIds.has(requiredDatabaseId(decision.target.id, "targetId")),
    );

    const queueDecisions = activeDecisions.filter(
      (decision) => decision.delivery.kind === "queue",
    );
    const queueIds = [...new Set(queueDecisions.map((decision) => (
      requiredDatabaseId(decision.delivery.kind === "queue" ? decision.delivery.queueId : "0", "queueId")
    )))];
    if (queueIds.length > 0) {
      const queues = await transaction
        .select({ id: queuesTable.id })
        .from(queuesTable)
        .where(and(
          inArray(queuesTable.id, queueIds),
          isNull(queuesTable.deleted_at),
        ))
        .for("share");
      const availableQueueIds = new Set(queues.map(({ id }) => id));
      const unavailable = queueIds.find((id) => !availableQueueIds.has(id));
      if (unavailable !== undefined) {
        throw new Error(`Queue ${unavailable} is unavailable`);
      }
    }

    const insertedSkips = skippedDecisions.length > 0
      ? await transaction.insert(eventRoutingSkipsTable).values(
        skippedDecisions.map(({ decision, reason }) => ({
          event_id: eventId,
          rule_id: requiredDatabaseId(decision.ruleId, "ruleId"),
          rule_version: decision.ruleVersion,
          target_id: requiredDatabaseId(decision.target.id, "targetId"),
          replay_id: replayId,
          reason,
        })),
      ).onConflictDoNothing().returning({ id: eventRoutingSkipsTable.id })
      : [];

    const insertedRoutes = activeDecisions.length > 0
      ? await transaction.insert(eventRoutesTable).values(
        activeDecisions.map((decision) => ({
          event_id: eventId,
          rule_id: requiredDatabaseId(decision.ruleId, "ruleId"),
          rule_version: decision.ruleVersion,
          target_id: requiredDatabaseId(decision.target.id, "targetId"),
          replay_id: replayId,
          priority: decision.priority,
          rule_pattern: decision.rulePattern,
          target_kind: decision.target.kind,
          target_config: decision.target.config,
        })),
      ).onConflictDoNothing().returning({
        id: eventRoutesTable.id,
        ruleId: eventRoutesTable.rule_id,
        ruleVersion: eventRoutesTable.rule_version,
        targetId: eventRoutesTable.target_id,
      })
      : [];

    const routeKey = (ruleId: bigint, ruleVersion: number, targetId: bigint): string => (
      `${ruleId}:${ruleVersion}:${targetId}`
    );
    const decisionsByRoute = new Map(activeDecisions.map((decision) => [
      routeKey(
        requiredDatabaseId(decision.ruleId, "ruleId"),
        decision.ruleVersion,
        requiredDatabaseId(decision.target.id, "targetId"),
      ),
      decision,
    ]));
    const createdDeliveries = insertedRoutes.flatMap((route) => {
      const decision = decisionsByRoute.get(routeKey(
        route.ruleId,
        route.ruleVersion,
        route.targetId,
      ));
      return decision ? [{ decision, route }] : [];
    });

    const queueMessages = createdDeliveries.flatMap(({ decision, route }) => (
      decision.delivery.kind === "queue"
        ? [{
          queue_id: requiredDatabaseId(decision.delivery.queueId, "queueId"),
          event_id: eventId,
          route_id: route.id,
          message_group_id: decision.delivery.messageGroupId,
          priority: decision.priority,
          visible_at: new Date(decision.delivery.visibleAt),
        }]
        : []
    ));
    let deliveriesCreated = 0;
    if (queueMessages.length > 0) {
      const insertedMessages = await transaction.insert(queueMessagesTable)
        .values(queueMessages)
        .onConflictDoNothing()
        .returning({ id: queueMessagesTable.id });
      for (const message of insertedMessages) {
        await transaction.execute(sql`select pg_notify(
          ${this.dependencies.queueChannel},
          ${String(message.id)}
        )`);
      }
      deliveriesCreated += insertedMessages.length;
    }

    const streamMessages = createdDeliveries.flatMap(({ decision, route }) => (
      decision.delivery.kind === "sse"
        ? [{
          stream_key: decision.delivery.streamKey,
          event_name: "event.routed",
          event_id: eventId,
          route_id: route.id,
          data: {
            priority: decision.priority,
            targetId: decision.target.id,
          },
        }]
        : []
    ));
    if (streamMessages.length > 0) {
      const insertedMessages = await transaction.insert(streamMessagesTable)
        .values(streamMessages)
        .onConflictDoNothing()
        .returning({ id: streamMessagesTable.id });
      for (const message of insertedMessages) {
        await transaction.execute(sql`select pg_notify(
          ${this.dependencies.sseChannel},
          ${String(message.id)}
        )`);
      }
      deliveriesCreated += insertedMessages.length;
    }

    const smsDeliveries = createdDeliveries.flatMap(({ decision, route }) => (
      decision.delivery.kind === "sms"
        ? [{
          event_id: eventId,
          route_id: route.id,
          reason: `event routed to SMS target ${decision.target.name}`,
          receive_count: 1,
        }]
        : []
    ));
    if (smsDeliveries.length > 0) {
      const insertedEscalations = await transaction.insert(escalationsTable)
        .values(smsDeliveries)
        .onConflictDoNothing()
        .returning({ id: escalationsTable.id });
      deliveriesCreated += insertedEscalations.length;
    }

    return {
      routesCreated: insertedRoutes.length,
      deliveriesCreated,
      skipsRecorded: insertedSkips.length,
    };
  }

  async commit(
    eventId: string,
    leaseToken: string,
    decisions: RoutingDecision[],
  ): Promise<CommitRoutingResult> {
    const parsedEventId = databaseId(eventId);
    if (parsedEventId === null) {
      return {
        committed: false,
        routesCreated: 0,
        deliveriesCreated: 0,
        skipsRecorded: 0,
      };
    }
    return this.dependencies.database.transaction(async (transaction) => {
      const [lease] = await transaction.select({ eventId: outboxTable.event_id })
        .from(outboxTable)
        .where(and(
          eq(outboxTable.event_id, parsedEventId),
          eq(outboxTable.status, "processing"),
          eq(outboxTable.lease_token, leaseToken),
        ))
        .for("update")
        .limit(1);
      if (!lease) {
        return {
          committed: false,
          routesCreated: 0,
          deliveriesCreated: 0,
          skipsRecorded: 0,
        };
      }

      const created = await this.createDeliveries(
        transaction,
        parsedEventId,
        null,
        decisions,
      );
      await transaction.update(outboxTable).set({
        status: "completed",
        locked_until: null,
        lease_token: null,
        completed_at: new Date(),
        last_error: null,
      }).where(and(
        eq(outboxTable.event_id, parsedEventId),
        eq(outboxTable.lease_token, leaseToken),
      ));

      return { committed: true, ...created };
    });
  }

  async getEventRoutes(eventId: string): Promise<EventRouteRecord[]> {
    const parsedEventId = databaseId(eventId);
    if (parsedEventId === null) return [];
    const rows = await this.dependencies.database.select().from(eventRoutesTable)
      .where(eq(eventRoutesTable.event_id, parsedEventId))
      .orderBy(asc(eventRoutesTable.id));
    return rows.map((row) => ({
      id: String(row.id),
      eventId: String(row.event_id),
      ruleId: String(row.rule_id),
      ruleVersion: row.rule_version,
      targetId: String(row.target_id),
      replayId: row.replay_id === null ? null : String(row.replay_id),
      priority: row.priority as Priority,
      rulePattern: row.rule_pattern,
      targetKind: row.target_kind as TargetKind,
      targetConfig: row.target_config,
      routedAt: row.routed_at.toISOString(),
    }));
  }

  async getEventRoutingSkips(eventId: string): Promise<EventRoutingSkipRecord[]> {
    const parsedEventId = databaseId(eventId);
    if (parsedEventId === null) return [];
    const rows = await this.dependencies.database.select().from(eventRoutingSkipsTable)
      .where(eq(eventRoutingSkipsTable.event_id, parsedEventId))
      .orderBy(asc(eventRoutingSkipsTable.id));
    return rows.map((row) => ({
      id: String(row.id),
      eventId: String(row.event_id),
      ruleId: String(row.rule_id),
      ruleVersion: row.rule_version,
      targetId: String(row.target_id),
      replayId: row.replay_id === null ? null : String(row.replay_id),
      reason: row.reason,
      recordedAt: row.recorded_at.toISOString(),
    }));
  }

  async createReplay(input: CreateReplayInput): Promise<ReplayRecord> {
    return this.dependencies.database.transaction(async (transaction) => {
      const [replay] = await transaction.insert(replaysTable).values({
        requested_by: input.requestedBy,
        reason: input.reason,
        event_filter: input.eventFilter,
        rule_id: input.ruleId === null
          ? null
          : requiredDatabaseId(input.ruleId, "ruleId"),
        rule_version: input.ruleVersion,
      }).returning();
      if (!replay) throw new Error("Replay insert returned no row");

      await transaction.insert(adminActionsTable).values({
        actor: input.requestedBy,
        action: "replay.created",
        resource_type: "replay",
        resource_id: String(replay.id),
        reason: input.reason,
        after: {
          eventFilter: input.eventFilter,
          ruleId: input.ruleId,
          ruleVersion: input.ruleVersion,
        },
      });
      return toReplay(replay);
    });
  }

  async getReplay(id: string): Promise<ReplayRecord | null> {
    const replayId = databaseId(id);
    if (replayId === null) return null;
    const [row] = await this.dependencies.database.select().from(replaysTable)
      .where(eq(replaysTable.id, replayId))
      .limit(1);
    return row ? toReplay(row) : null;
  }

  async listReplays(limit = 100, beforeId?: string): Promise<ReplayRecord[]> {
    const cursor = beforeId === undefined ? undefined : databaseId(beforeId);
    const rows = await this.dependencies.database.select().from(replaysTable)
      .where(cursor === undefined ? undefined : lt(replaysTable.id, cursor ?? 0n))
      .orderBy(desc(replaysTable.id))
      .limit(limit);
    return rows.map(toReplay);
  }

  async claimReplay(leaseSeconds: number): Promise<ClaimedReplay | null> {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1) {
      throw new RangeError("leaseSeconds must be a positive integer");
    }
    const leaseToken = randomUUID();
    return this.dependencies.database.transaction(async (transaction) => {
      const result = await transaction.execute(sql`
        with candidate as (
          select id
          from replays
          where (
            status = 'pending' and available_at <= now()
          ) or (
            status = 'running' and locked_until <= now()
          )
          order by available_at, id
          for update skip locked
          limit 1
        )
        update replays as replay
        set status = 'running',
            lease_token = ${leaseToken},
            locked_until = now() + (${leaseSeconds} * interval '1 second'),
            attempts = attempts + 1,
            last_error = null,
            updated_at = now()
        from candidate
        where replay.id = candidate.id
        returning replay.id
      `);
      const raw = result.rows[0];
      if (!raw) return null;
      const [row] = await transaction.select().from(replaysTable)
        .where(eq(replaysTable.id, BigInt(String(raw.id))))
        .limit(1);
      if (!row) throw new Error("Claimed replay disappeared");
      return { ...toReplay(row), leaseToken };
    });
  }

  async loadReplayEvents(
    filter: ReplayFilter,
    afterEventId = "0",
    limit = 100,
  ): Promise<StoredEvent[]> {
    const after = afterEventId === "0" ? 0n : databaseId(afterEventId);
    if (after === null) throw new RangeError("afterEventId must be a non-negative integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("limit must be between 1 and 1000");
    }
    const conditions = [];
    conditions.push(gt(eventsTable.id, after));
    if (filter.source?.length) conditions.push(inArray(eventsTable.source, filter.source));
    if (filter.type?.length) conditions.push(inArray(eventsTable.type, filter.type));
    if (filter.from) conditions.push(gte(eventsTable.occurred_at, new Date(filter.from)));
    if (filter.to) conditions.push(lte(eventsTable.occurred_at, new Date(filter.to)));
    if (filter.eventIds?.length) {
      conditions.push(inArray(
        eventsTable.id,
        filter.eventIds.map((id) => requiredDatabaseId(id, "eventId")),
      ));
    }

    const eventIds = await this.dependencies.database
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(...conditions))
      .orderBy(asc(eventsTable.id))
      .limit(limit);
    if (eventIds.length === 0) return [];

    const rows = await this.dependencies.database
      .select({ event: eventsTable, link: eventLinksTable })
      .from(eventsTable)
      .leftJoin(eventLinksTable, eq(eventLinksTable.event_id, eventsTable.id))
      .where(inArray(eventsTable.id, eventIds.map(({ id }) => id)))
      .orderBy(asc(eventsTable.id));
    return toStoredEvents(rows);
  }

  async loadReplayRules(
    ruleId: string | null,
    ruleVersion: number | null,
  ): Promise<RuleSnapshot[]> {
    if (ruleId === null) {
      return this.loadCurrentRuleSnapshots(this.dependencies.database, and(
        ne(rulesTable.name, DEFAULT_RULE_NAME),
        eq(rulesTable.enabled, true),
        isNull(rulesTable.deleted_at),
      ));
    }

    const numericRuleId = databaseId(ruleId);
    if (numericRuleId === null) return [];
    return this.loadRuleSnapshots(
      this.dependencies.database,
      eq(rulesTable.id, numericRuleId),
      ruleVersion === null
        ? eq(ruleVersionsTable.version, rulesTable.current_version)
        : eq(ruleVersionsTable.version, ruleVersion),
    );
  }

  async commitReplayBatch(
    replayId: string,
    leaseToken: string,
    events: { eventId: string; decisions: RoutingDecision[] }[],
    completed: boolean,
  ): Promise<boolean> {
    return this.dependencies.database.transaction(async (transaction) => {
      const parsedReplayId = databaseId(replayId);
      if (parsedReplayId === null) return false;
      const [lease] = await transaction.select({ id: replaysTable.id })
        .from(replaysTable)
        .where(and(
          eq(replaysTable.id, parsedReplayId),
          eq(replaysTable.status, "running"),
          eq(replaysTable.lease_token, leaseToken),
          gt(replaysTable.locked_until, sql`now()`),
        ))
        .for("update")
        .limit(1);
      if (!lease) return false;

      for (const event of events) {
        await this.createDeliveries(
          transaction,
          requiredDatabaseId(event.eventId, "eventId"),
          parsedReplayId,
          event.decisions,
        );
      }

      const lastEventId = events.at(-1)?.eventId;
      const [updated] = await transaction.update(replaysTable).set({
        status: completed ? "completed" : "pending",
        events_matched: sql`coalesce(${replaysTable.events_matched}, 0) + ${events.length}`,
        last_event_id: lastEventId === undefined
          ? undefined
          : requiredDatabaseId(lastEventId, "eventId"),
        available_at: new Date(),
        locked_until: null,
        lease_token: null,
        updated_at: new Date(),
        completed_at: completed ? new Date() : null,
      }).where(and(
        eq(replaysTable.id, parsedReplayId),
        eq(replaysTable.lease_token, leaseToken),
      )).returning({ id: replaysTable.id });
      return updated !== undefined;
    });
  }

  async failReplay(
    replayId: string,
    leaseToken: string,
    error: string,
    retryDelaySeconds: number,
    maxAttempts: number,
  ): Promise<boolean> {
    const parsedReplayId = databaseId(replayId);
    if (parsedReplayId === null) return false;
    const [updated] = await this.dependencies.database.update(replaysTable).set({
      status: sql`case when ${replaysTable.attempts} >= ${maxAttempts}
        then 'failed' else 'pending' end`,
      available_at: sql`now() + (${retryDelaySeconds} * interval '1 second')`,
      locked_until: null,
      lease_token: null,
      last_error: error.slice(0, 1_000),
      updated_at: new Date(),
      completed_at: sql`case when ${replaysTable.attempts} >= ${maxAttempts}
        then now() else null end`,
    }).where(and(
      eq(replaysTable.id, parsedReplayId),
      eq(replaysTable.status, "running"),
      eq(replaysTable.lease_token, leaseToken),
    )).returning({ id: replaysTable.id });
    return updated !== undefined;
  }
}

function resolveChannel(
  value: string | undefined,
  name: string,
  fallback: string,
): string {
  const channel = value || fallback;
  if (!/^[a-z_][a-z0-9_$]*$/i.test(channel)) {
    throw new Error(`${name} must be a valid PostgreSQL identifier`);
  }
  return channel;
}

export const createRoutingRepo = (
  options: Partial<RoutingRepoDependencies> = {},
): RoutingRepo => new RoutingRepo({
  database: options.database ?? db,
  sseChannel: resolveChannel(
    options.sseChannel ?? process.env.SSE_CHANNEL,
    "SSE_CHANNEL",
    "sse_ready",
  ),
  queueChannel: resolveChannel(
    options.queueChannel ?? process.env.QUEUE_CHANNEL,
    "QUEUE_CHANNEL",
    "queue_ready",
  ),
  ruleCacheTtlMs: options.ruleCacheTtlMs ?? 1_000,
});

export const routingRepo = createRoutingRepo();
