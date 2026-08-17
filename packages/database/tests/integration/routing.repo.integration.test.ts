import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createEventsRepo, type EventsRepo } from "../../src/repos/events/events.repo.js";
import type { EventToIngest } from "../../src/repos/events/events.types.js";
import {
  createRoutingRepo,
  type RoutingRepo,
} from "../../src/repos/routing/routing.repo.js";
import type {
  ClaimedRoutingWork,
  RoutingDecision,
  RuleSnapshot,
} from "../../src/repos/routing/routing.types.js";
import { createRulesRepo, type RulesRepo } from "../../src/repos/rules/rules.repo.js";
import { createTargetsRepo, type TargetsRepo } from "../../src/repos/targets/targets.repo.js";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const schema = `routing_test_${randomUUID().replaceAll("-", "")}`;
const sseChannel = `sse_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

let adminPool: Pool;
let testPool: Pool;
let eventsRepo: EventsRepo;
let routingRepo: RoutingRepo;
let secondRoutingRepo: RoutingRepo;
let rulesRepo: RulesRepo;
let targetsRepo: TargetsRepo;

function event(overrides: Partial<EventToIngest> = {}): EventToIngest {
  return {
    source: "github",
    sourceEventId: randomUUID(),
    type: "push.created",
    subject: "owner/repository",
    actor: "octocat",
    summary: "Pushed commit",
    occurredAt: "2026-08-16T12:00:00.000Z",
    correlationId: null,
    causationEventId: null,
    traceId: null,
    detail: {},
    attributes: {},
    links: [{ kind: "repository", value: "owner/repository" }],
    ...overrides,
  };
}

async function applyMigrations(): Promise<void> {
  const migrationsRoot = new URL("../../drizzle/", import.meta.url);
  const directories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const directory of directories) {
    const migration = await readFile(
      new URL(`${directory.name}/migration.sql`, migrationsRoot),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await testPool.query(statement);
    }
  }
}

function decisionsFor(rule: RuleSnapshot): RoutingDecision[] {
  return rule.targets.map((target) => {
    if (!target.enabled || target.deletedAt !== null) {
      return {
        ruleId: rule.id,
        ruleVersion: rule.version,
        rulePattern: rule.pattern,
        priority: rule.priority,
        target,
        delivery: {
          kind: "skipped" as const,
          reason: target.deletedAt === null ? "target_disabled" : "target_deleted",
        },
      };
    }
    if (target.kind !== "queue" || !target.queue) {
      throw new Error("Integration test expected a queue target");
    }
    return {
      ruleId: rule.id,
      ruleVersion: rule.version,
      rulePattern: rule.pattern,
      priority: rule.priority,
      target,
      delivery: {
        kind: "queue" as const,
        queueId: target.queue.id,
        messageGroupId: target.queue.name,
        visibleAt: "2026-08-16T12:00:01.000Z",
      },
    };
  });
}

function selectedRule(work: ClaimedRoutingWork): RuleSnapshot {
  return work.rules[0] ?? work.defaultRule;
}

async function createQueueTarget(name: string, queueName = "career") {
  const queue = (await targetsRepo.listQueues()).find((item) => item.name === queueName);
  if (!queue) throw new Error(`Seeded ${queueName} queue is missing`);
  return targetsRepo.createTarget({
    name,
    kind: "queue",
    config: { queueId: Number(queue.id) },
    enabled: true,
  });
}

beforeAll(async () => {
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for integration tests");
  }

  adminPool = new Pool({ connectionString });
  await adminPool.query(`create schema "${schema}"`);
  testPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await applyMigrations();

  const database = drizzle({ client: testPool });
  eventsRepo = createEventsRepo({ database, eventsChannel: "events_ready_test" });
  routingRepo = createRoutingRepo({ database, sseChannel });
  secondRoutingRepo = createRoutingRepo({ database, sseChannel });
  rulesRepo = createRulesRepo(database);
  targetsRepo = createTargetsRepo(database);
}, 30_000);

beforeEach(async () => {
  await testPool.query(`
    delete from stream_messages;
    delete from triage_items;
    delete from consumer_inbox;
    delete from message_attempts;
    delete from target_tests;
    delete from queue_messages;
    delete from event_routing_skips;
    delete from event_routes;
    delete from replays;
    delete from admin_actions;
    delete from outbox;
    delete from event_links;
    delete from events;
    delete from rule_targets
      where rule_id <> (select id from rules where name = 'system.unclassified');
    delete from targets where name <> 'system.unclassified.queue';
    delete from rule_versions
      where rule_id <> (select id from rules where name = 'system.unclassified');
    delete from rules where name <> 'system.unclassified';
    update targets set enabled = true, deleted_at = null
      where name = 'system.unclassified.queue';
    update rules set enabled = true, deleted_at = null, validation_error = null, invalid_at = null
      where name = 'system.unclassified';
  `);
});

afterAll(async () => {
  await testPool?.end();
  await adminPool?.query(`drop schema if exists "${schema}" cascade`);
  await adminPool?.end();
});

describe("routing coordination and idempotency", () => {
  test("two router instances cannot claim the same event", async () => {
    await eventsRepo.ingestEvent(event());

    const claims = await Promise.all([
      routingRepo.claimNext(),
      secondRoutingRepo.claimNext(),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = claims.find((item) => item !== null)!;
    await routingRepo.commit(
      claimed.event.id,
      claimed.leaseToken,
      decisionsFor(claimed.defaultRule),
    );
  });

  test("one event fans out once per target and a post-commit retry is harmless", async () => {
    const firstTarget = await createQueueTarget("career.primary");
    const secondTarget = await createQueueTarget("career.secondary", "personal");
    const rule = await rulesRepo.createRule({
      name: "github.all",
      pattern: { source: ["github"] },
      priority: "urgent",
      enabled: true,
    });
    await rulesRepo.attachTarget(rule.id, firstTarget.id);
    await rulesRepo.attachTarget(rule.id, secondTarget.id);
    await eventsRepo.ingestEvent(event());
    const work = await routingRepo.claimNext();
    expect(work).not.toBeNull();

    const decisions = decisionsFor(selectedRule(work!));
    await expect(routingRepo.commit(work!.event.id, work!.leaseToken, decisions))
      .resolves.toMatchObject({ committed: true, routesCreated: 2, deliveriesCreated: 2 });
    await expect(routingRepo.commit(work!.event.id, work!.leaseToken, decisions))
      .resolves.toEqual({
        committed: false,
        routesCreated: 0,
        deliveriesCreated: 0,
        skipsRecorded: 0,
      });

    const counts = await testPool.query(`select
      (select count(*)::int from event_routes) as routes,
      (select count(*)::int from queue_messages) as messages,
      (select status from outbox where event_id = $1) as status`, [work!.event.id]);
    expect(counts.rows[0]).toEqual({ routes: 2, messages: 2, status: "completed" });
  });

  test("a crash before commit recovers after lease expiry without accepting the stale lease", async () => {
    await eventsRepo.ingestEvent(event());
    const abandoned = await routingRepo.claimNext();
    expect(abandoned).not.toBeNull();
    await testPool.query(
      "update outbox set locked_until = now() - interval '1 second' where event_id = $1",
      [abandoned!.event.id],
    );

    const recovered = await secondRoutingRepo.claimNext();
    expect(recovered?.leaseToken).not.toBe(abandoned!.leaseToken);
    await expect(routingRepo.commit(
      abandoned!.event.id,
      abandoned!.leaseToken,
      decisionsFor(abandoned!.defaultRule),
    )).resolves.toMatchObject({ committed: false });
    await expect(secondRoutingRepo.commit(
      recovered!.event.id,
      recovered!.leaseToken,
      decisionsFor(recovered!.defaultRule),
    )).resolves.toMatchObject({ committed: true, routesCreated: 1 });

    const routes = await testPool.query("select count(*)::int as count from event_routes");
    expect(routes.rows[0]).toEqual({ count: 1 });
  });

  test("SSE creates a durable route and emits only an ID notification after commit", async () => {
    const target = await targetsRepo.createTarget({
      name: "dashboard.triage",
      kind: "sse",
      config: { streamKey: "triage", replayRetentionSeconds: 3_600 },
      enabled: true,
    });
    const rule = await rulesRepo.createRule({
      name: "github.dashboard",
      pattern: { source: ["github"] },
      priority: "normal",
      enabled: true,
    });
    await rulesRepo.attachTarget(rule.id, target.id);
    await eventsRepo.ingestEvent(event());
    const work = await routingRepo.claimNext();
    const snapshot = selectedRule(work!).targets[0]!;

    const listener = new Client({ connectionString: connectionString! });
    await listener.connect();
    await listener.query(`listen "${sseChannel}"`);
    const notification = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("SSE notification timed out")), 2_000);
      listener.once("notification", (message) => {
        clearTimeout(timeout);
        resolve(message.payload ?? "");
      });
    });

    try {
      await routingRepo.commit(work!.event.id, work!.leaseToken, [{
        ruleId: rule.id,
        ruleVersion: 1,
        rulePattern: { source: ["github"] },
        priority: "normal",
        target: snapshot,
        delivery: { kind: "sse", streamKey: "triage" },
      }]);

      const streamMessageId = await notification;
      expect(streamMessageId).toMatch(/^\d+$/);
      const streamMessage = await testPool.query(
        "select stream_key, event_id, route_id from stream_messages where id = $1",
        [streamMessageId],
      );
      expect(streamMessage.rows).toMatchObject([{
        stream_key: "triage",
        event_id: work!.event.id,
        route_id: expect.any(String),
      }]);
      await expect(routingRepo.getEventRoutes(work!.event.id)).resolves.toMatchObject([{
        targetKind: "sse",
      }]);
    } finally {
      await listener.end();
    }
  });

  test("SMS routing records durable intent without creating a queue delivery", async () => {
    const target = await targetsRepo.createTarget({
      name: "sms.escalation",
      kind: "sms",
      config: {},
      enabled: true,
    });
    const rule = await rulesRepo.createRule({
      name: "github.escalation",
      pattern: { source: ["github"] },
      priority: "urgent",
      enabled: true,
    });
    await rulesRepo.attachTarget(rule.id, target.id);
    await eventsRepo.ingestEvent(event());
    const work = await routingRepo.claimNext();
    const snapshot = selectedRule(work!).targets[0]!;

    await routingRepo.commit(work!.event.id, work!.leaseToken, [{
      ruleId: rule.id,
      ruleVersion: 1,
      rulePattern: { source: ["github"] },
      priority: "urgent",
      target: snapshot,
      delivery: { kind: "sms" },
    }]);

    const counts = await testPool.query(`select
      (select count(*)::int from event_routes where event_id = $1 and target_kind = 'sms') as routes,
      (select count(*)::int from queue_messages where event_id = $1) as queue_messages`,
    [work!.event.id]);
    expect(counts.rows[0]).toEqual({ routes: 1, queue_messages: 0 });
  });
});

describe("version, target lifecycle, and replay history", () => {
  test("a rule edit cannot change the version captured for an in-flight event", async () => {
    const target = await createQueueTarget("career.versioned");
    const rule = await rulesRepo.createRule({
      name: "github.versioned",
      pattern: { source: ["github"] },
      priority: "normal",
      enabled: true,
    });
    await rulesRepo.attachTarget(rule.id, target.id);
    await eventsRepo.ingestEvent(event());
    const work = await routingRepo.claimNext();
    expect(selectedRule(work!).version).toBe(1);

    const updated = await rulesRepo.updateRule(rule.id, {
      pattern: { source: ["github"], type: ["push.created"] },
      priority: "urgent",
    });
    expect(updated?.currentVersion).toBe(2);
    await routingRepo.commit(
      work!.event.id,
      work!.leaseToken,
      decisionsFor(selectedRule(work!)),
    );

    const route = await testPool.query(
      "select rule_version, priority, rule_pattern from event_routes where event_id = $1",
      [work!.event.id],
    );
    expect(route.rows).toEqual([{
      rule_version: 1,
      priority: "normal",
      rule_pattern: { source: ["github"] },
    }]);
  });

  test("an invalid captured version cannot disable a newer valid rule version", async () => {
    const rule = await rulesRepo.createRule({
      name: "github.invalid-race",
      pattern: { source: [{ suffix: "hub" }] },
      priority: "normal",
      enabled: true,
    });
    await rulesRepo.updateRule(rule.id, {
      pattern: { source: ["github"] },
    });

    await routingRepo.markRuleInvalid(rule.id, 1, "old version is malformed");

    await expect(rulesRepo.getRule(rule.id)).resolves.toMatchObject({
      enabled: true,
      currentVersion: 2,
      validationError: null,
    });
  });

  test("a disabled target gets no new route while its historic route remains readable", async () => {
    const target = await createQueueTarget("career.lifecycle");
    const rule = await rulesRepo.createRule({
      name: "github.lifecycle",
      pattern: { source: ["github"] },
      priority: "normal",
      enabled: true,
    });
    await rulesRepo.attachTarget(rule.id, target.id);

    const first = await eventsRepo.ingestEvent(event());
    const firstWork = await routingRepo.claimNext();
    await routingRepo.commit(
      firstWork!.event.id,
      firstWork!.leaseToken,
      decisionsFor(selectedRule(firstWork!)),
    );
    await targetsRepo.setEnabled(target.id, false);

    const second = await eventsRepo.ingestEvent(event());
    const secondWork = await routingRepo.claimNext();
    expect(selectedRule(secondWork!).targets).toMatchObject([{ enabled: false }]);
    await routingRepo.commit(
      secondWork!.event.id,
      secondWork!.leaseToken,
      decisionsFor(selectedRule(secondWork!)),
    );

    expect(await routingRepo.getEventRoutes(first.id)).toHaveLength(1);
    expect(await routingRepo.getEventRoutes(second.id)).toHaveLength(0);
    await expect(routingRepo.getEventRoutingSkips(second.id)).resolves.toMatchObject([{
      reason: "target_disabled",
      targetId: target.id,
    }]);
    await expect(targetsRepo.deleteTarget(target.id)).resolves.toBe("in_use");

    const personal = (await targetsRepo.listQueues()).find((item) => item.name === "personal")!;
    await targetsRepo.updateTarget(target.id, {
      config: { queueId: Number(personal.id) },
    });
    await rulesRepo.detachTarget(rule.id, target.id);
    await expect(targetsRepo.deleteTarget(target.id)).resolves.toBe("deleted");

    const historic = await routingRepo.getEventRoutes(first.id);
    expect(historic).toMatchObject([{
      targetId: target.id,
      targetConfig: target.config,
    }]);
  });

  test("replay is audited, pinned, idempotent within a run, and carries replay_id", async () => {
    const target = await createQueueTarget("career.replay");
    const rule = await rulesRepo.createRule({
      name: "github.replay",
      pattern: { source: ["github"] },
      priority: "normal",
      enabled: true,
    });
    await rulesRepo.attachTarget(rule.id, target.id);
    await rulesRepo.updateRule(rule.id, {
      pattern: { source: ["github"], type: ["push.created"] },
      priority: "urgent",
    });
    const stored = await eventsRepo.ingestEvent(event());

    const replay = await routingRepo.createReplay({
      requestedBy: "njabulo",
      reason: "Investigate deployment incident",
      eventFilter: { eventIds: [stored.id] },
      ruleId: rule.id,
      ruleVersion: 1,
    });
    const [pinned] = await routingRepo.loadReplayRules(rule.id, 1);
    expect(pinned?.version).toBe(1);
    const decisions = decisionsFor(pinned!);
    await routingRepo.commitReplayEvent(replay.id, stored.id, decisions);
    await routingRepo.commitReplayEvent(replay.id, stored.id, decisions);

    const rows = await testPool.query(`select
      (select count(*)::int from event_routes where replay_id = $1) as routes,
      (select count(*)::int from admin_actions where resource_id = $2 and action = 'replay.created') as audits,
      (select rule_version from event_routes where replay_id = $1 limit 1) as version`,
    [replay.id, replay.id]);
    expect(rows.rows[0]).toEqual({ routes: 1, audits: 1, version: 1 });
  });

  test("a target test is a durable synthetic delivery with an audit but no event route", async () => {
    const target = await createQueueTarget("career.test");

    const testId = await targetsRepo.scheduleTargetTest(
      target,
      "njabulo",
      "Verify the destination before enabling a rule",
    );

    const rows = await testPool.query(`select
      (select count(*)::int from target_tests where id = $1 and status = 'pending') as tests,
      (select count(*)::int from admin_actions where resource_id = $2 and action = 'target.test_scheduled') as audits,
      (select count(*)::int from event_routes) as routes`, [testId, testId]);
    expect(rows.rows[0]).toEqual({ tests: 1, audits: 1, routes: 0 });
  });
});
