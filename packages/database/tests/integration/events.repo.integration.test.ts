import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createEventsRepo,
  type EventsRepo,
} from "../../src/repos/events/events.repo.js";
import type { EventToIngest } from "../../src/repos/events/events.types.js";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const schema = `ingestion_test_${randomUUID().replaceAll("-", "")}`;

let adminPool: Pool;
let testPool: Pool;
let eventsRepo: EventsRepo;

function event(overrides: Partial<EventToIngest> = {}): EventToIngest {
  return {
    source: "github",
    sourceEventId: randomUUID(),
    type: "pull_request.merged",
    subject: "owner/repository#42",
    actor: "octocat",
    summary: "octocat merged pull request #42",
    occurredAt: "2026-08-16T12:00:00.000Z",
    correlationId: null,
    causationEventId: null,
    traceId: null,
    detail: { sourceEventType: "pull_request", raw: {} },
    attributes: { repository: "owner/repository" },
    links: [
      { kind: "repository", value: "owner/repository" },
      { kind: "pull_request", value: "owner/repository#42" },
    ],
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

beforeAll(async () => {
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for integration tests");
  }

  adminPool = new Pool({ connectionString });
  await adminPool.query(`create schema "${schema}"`);
  testPool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  await applyMigrations();

  const database = drizzle({ client: testPool });
  eventsRepo = createEventsRepo({ database, eventsChannel: "events_ready_test" });
}, 30_000);

afterAll(async () => {
  await testPool?.end();
  await adminPool?.query(`drop schema if exists "${schema}" cascade`);
  await adminPool?.end();
});

describe("event ingestion transaction", () => {
  test("creates one event, every link, and one pending outbox row", async () => {
    const input = event();
    const result = await eventsRepo.ingestEvent(input);

    const eventRows = await testPool.query(
      "select * from events where id = $1",
      [result.id],
    );
    const linkRows = await testPool.query(
      "select kind, value from event_links where event_id = $1 order by kind",
      [result.id],
    );
    const outboxRows = await testPool.query(
      "select status from outbox where event_id = $1",
      [result.id],
    );

    expect(result.inserted).toBe(true);
    expect(eventRows.rowCount).toBe(1);
    expect(linkRows.rows).toEqual([
      { kind: "pull_request", value: "owner/repository#42" },
      { kind: "repository", value: "owner/repository" },
    ]);
    expect(outboxRows.rows).toEqual([{ status: "pending" }]);
  });

  test("returns every event link from the joined read paths", async () => {
    const result = await eventsRepo.ingestEvent(event());

    const byId = await eventsRepo.getEventById(result.id);
    const fromList = (await eventsRepo.getEvents()).find(({ id }) => id === result.id);

    for (const stored of [byId, fromList]) {
      expect(stored?.links).toHaveLength(2);
      expect(stored?.links).toEqual(expect.arrayContaining([
        { kind: "repository", value: "owner/repository" },
        { kind: "pull_request", value: "owner/repository#42" },
      ]));
    }
  });

  test.each(["github", "gmail"])(
    "deduplicates repeated %s source events and their outbox rows",
    async (source) => {
      const sourceEventId = `${source}-${randomUUID()}`;
      const input = event({ source, sourceEventId });

      const [first, second] = await Promise.all([
        eventsRepo.ingestEvent(input),
        eventsRepo.ingestEvent(input),
      ]);
      const counts = await testPool.query(
        `select
          (select count(*)::int from events where source = $1 and source_event_id = $2) as events,
          (select count(*)::int from outbox where event_id = $3) as outbox`,
        [source, sourceEventId, first.id],
      );

      expect(first.id).toBe(second.id);
      expect([first.inserted, second.inserted].sort()).toEqual([false, true]);
      expect(counts.rows[0]).toEqual({ events: 1, outbox: 1 });
    },
  );

  test("rolls the event back when a later link insert fails", async () => {
    const sourceEventId = `rollback-${randomUUID()}`;
    const duplicateLink = { kind: "repository", value: "owner/repository" };

    await expect(eventsRepo.ingestEvent(event({
      sourceEventId,
      links: [duplicateLink, duplicateLink],
    }))).rejects.toThrow();

    const result = await testPool.query(
      "select count(*)::int as count from events where source_event_id = $1",
      [sourceEventId],
    );
    expect(result.rows[0]).toEqual({ count: 0 });
  });

  test("preserves PostgreSQL bigint IDs beyond JavaScript's safe integer range", async () => {
    const expectedId = "9007199254740993";
    await testPool.query("select setval('events_id_seq', $1, false)", [expectedId]);

    const result = await eventsRepo.ingestEvent(event());
    const stored = await eventsRepo.getEventById(expectedId);

    expect(result.id).toBe(expectedId);
    expect(stored?.id).toBe(expectedId);
  });

  test("uses a stable occurred-at and ID cursor for bounded event pages", async () => {
    const newest = await eventsRepo.ingestEvent(event({
      occurredAt: "2026-08-18T12:00:00.000Z",
    }));
    const older = await eventsRepo.ingestEvent(event({
      occurredAt: "2026-08-17T12:00:00.000Z",
    }));

    const firstPage = await eventsRepo.getEvents(1);
    expect(firstPage).toHaveLength(1);
    const cursor = firstPage[0]!;
    const secondPage = await eventsRepo.getEvents(250, cursor.occurredAt, cursor.id);

    expect(firstPage[0]?.id).toBe(newest.id);
    expect(secondPage.map(({ id }) => id)).toContain(older.id);
    expect(secondPage.map(({ id }) => id)).not.toContain(newest.id);
  });

});
