import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createEventsRepo, type EventsRepo } from "../../src/repos/events/events.repo.js";
import type { EventToIngest } from "../../src/repos/events/events.types.js";
import { createQueuesRepo, type QueuesRepo } from "../../src/repos/queues/queues.repo.js";
import { createStreamsRepo, type StreamsRepo } from "../../src/repos/triage/streams.repo.js";
import { createThreadsRepo, type ThreadsRepo } from "../../src/repos/triage/threads.repo.js";
import { createTriageRepo, type TriageRepo } from "../../src/repos/triage/triage.repo.js";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const schema = `queues_test_${randomUUID().replaceAll("-", "")}`;
const queueChannel = `queue_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const sseChannel = `sse_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

let adminPool: Pool;
let testPool: Pool;
let eventsRepo: EventsRepo;
let queuesRepo: QueuesRepo;
let secondQueuesRepo: QueuesRepo;
let triageRepo: TriageRepo;
let streamsRepo: StreamsRepo;
let threadsRepo: ThreadsRepo;

function event(): EventToIngest {
  return {
    source: "example",
    sourceEventId: randomUUID(),
    type: "message.received",
    subject: "example-thread",
    actor: "example-sender",
    summary: "Example notification",
    occurredAt: new Date().toISOString(),
    correlationId: null,
    causationEventId: null,
    traceId: null,
    detail: {},
    attributes: {},
    links: [{ kind: "thread", value: "example-thread" }],
  };
}

async function applyMigrations(): Promise<void> {
  const root = new URL("../../drizzle/", import.meta.url);
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const directory of directories) {
    const migration = await readFile(new URL(`${directory.name}/migration.sql`, root), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await testPool.query(statement);
    }
  }
}

beforeAll(async () => {
  if (!connectionString) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
  adminPool = new Pool({ connectionString });
  await adminPool.query(`create schema "${schema}"`);
  testPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await applyMigrations();
  const database = drizzle({ client: testPool });
  eventsRepo = createEventsRepo({ database, eventsChannel: "events_ready_test" });
  queuesRepo = createQueuesRepo({ database, queueChannel });
  secondQueuesRepo = createQueuesRepo({ database, queueChannel });
  triageRepo = createTriageRepo({ database, sseChannel });
  streamsRepo = createStreamsRepo(database);
  threadsRepo = createThreadsRepo({ database, sseChannel });
}, 30_000);

beforeEach(async () => {
  await testPool.query(`
    delete from stream_messages;
    delete from triage_items;
    delete from thread_messages;
    delete from threads;
    delete from consumer_inbox;
    delete from message_attempts;
    delete from queue_messages;
    delete from event_routing_skips;
    delete from event_routes;
    delete from outbox;
    delete from event_links;
    delete from events;
  `);
});

afterAll(async () => {
  await testPool?.end();
  await adminPool?.query(`drop schema if exists "${schema}" cascade`);
  await adminPool?.end();
});

async function enqueue() {
  const stored = await eventsRepo.ingestEvent(event());
  const queue = await queuesRepo.getQueueByName("career");
  if (!queue) throw new Error("Seeded career queue is missing");
  const message = await queuesRepo.sendMessage({
    queueId: queue.id,
    eventId: stored.id,
    delaySeconds: 0,
    messageGroupId: "career",
    priority: "urgent",
  });
  if (!message) throw new Error("Message was not enqueued");
  return { queue, message };
}

function claimInput(message: NonNullable<Awaited<ReturnType<QueuesRepo["receiveMessages"]>>>[number]) {
  return {
    message,
    consumerName: "dashboard:career",
    consumerInstanceId: randomUUID(),
    streamKey: "triage",
    threadKey: "example:thread:example-thread",
    title: "Example thread",
    decision: {
      domain: "career",
      priority: "normal" as const,
      channel: "web" as const,
      brief: "Example notification",
      decidedBy: "rule-stub" as const,
      reason: "rule-stub:example:message.received",
    },
  };
}

describe("queue claims and visibility", () => {
  test("competing consumers cannot claim the same message", async () => {
    const { queue } = await enqueue();

    const claims = await Promise.all([
      queuesRepo.receiveMessages({
        queueId: queue.id,
        maxMessages: 1,
        visibilityTimeoutSeconds: 30,
        consumerName: "worker-a",
      }),
      secondQueuesRepo.receiveMessages({
        queueId: queue.id,
        maxMessages: 1,
        visibilityTimeoutSeconds: 30,
        consumerName: "worker-b",
      }),
    ]);

    expect(claims.flat()).toHaveLength(1);
  });

  test("an expired lease returns with a new handle and rejects stale ACK", async () => {
    const { queue, message } = await enqueue();
    const [first] = await queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      visibilityTimeoutSeconds: 30,
      consumerName: "crashing-worker",
    }) ?? [];
    expect(first?.receiveCount).toBe(1);
    await testPool.query(
      "update queue_messages set visible_at = now() - interval '1 second' where id = $1",
      [message.id],
    );

    const [second] = await secondQueuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      visibilityTimeoutSeconds: 30,
      consumerName: "recovery-worker",
    }) ?? [];
    expect(second?.receiveCount).toBe(2);
    expect(second?.receiptHandle).not.toBe(first?.receiptHandle);
    await expect(queuesRepo.ackMessage(
      queue.id,
      message.id,
      first!.receiptHandle!,
      "crashing-worker",
    )).resolves.toBe(false);
    await expect(secondQueuesRepo.ackMessage(
      queue.id,
      message.id,
      second!.receiptHandle!,
      "recovery-worker",
    )).resolves.toBe(true);

    const attempts = await queuesRepo.listAttempts(message.id);
    expect(attempts.map(({ outcome }) => outcome)).toEqual(["received", "received", "acked"]);
    const remaining = await testPool.query(
      "select count(*)::int as count from queue_messages where id = $1",
      [message.id],
    );
    expect(remaining.rows[0]).toEqual({ count: 0 });
  });

  test("snooze clears the lease and delays redelivery", async () => {
    const { queue, message } = await enqueue();
    const [claimed] = await queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "dashboard",
    }) ?? [];
    await expect(queuesRepo.snoozeMessage(
      queue.id,
      message.id,
      claimed!.receiptHandle!,
      "dashboard",
      3_600,
    )).resolves.toBe(true);
    await expect(queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "dashboard",
    })).resolves.toEqual([]);
  });
});

describe("dashboard inbox and durable stream", () => {
  test("redelivery updates one triage item and appends replayable state", async () => {
    const { queue, message } = await enqueue();
    const [first] = await queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "dashboard:career",
    }) ?? [];
    const firstItem = await triageRepo.storeClaim({
      ...claimInput(first!),
    });
    await queuesRepo.releaseMessage(
      queue.id,
      message.id,
      first!.receiptHandle!,
      "dashboard:career",
    );
    const [second] = await queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "dashboard:career",
    }) ?? [];
    const secondItem = await triageRepo.storeClaim({
      ...claimInput(second!),
    });

    expect(secondItem.id).toBe(firstItem.id);
    expect(secondItem.receiptHandle).toBe(second!.receiptHandle);
    const counts = await testPool.query(`select
      (select count(*)::int from consumer_inbox) as inbox,
      (select count(*)::int from triage_items) as items,
      (select count(*)::int from stream_messages) as stream`);
    expect(counts.rows[0]).toEqual({ inbox: 1, items: 1, stream: 2 });

    const messages = await streamsRepo.listMessages("triage", "0");
    expect(messages.map(({ eventName }) => eventName)).toEqual([
      "triage.item.available",
      "triage.item.available",
    ]);
    expect(messages[1]?.triageItem?.receiptHandle).toBe(second!.receiptHandle);
    await expect(streamsRepo.getHighWaterMark("triage")).resolves.toBe(messages[1]!.id);
    await expect(streamsRepo.listMessages("triage", messages[0]!.id)).resolves.toMatchObject([
      { id: messages[1]!.id },
    ]);
  });

  test("ACK updates the durable board and deletes queue work atomically", async () => {
    const { queue } = await enqueue();
    const [message] = await queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "dashboard:career",
    }) ?? [];
    const item = await triageRepo.storeClaim({
      ...claimInput(message!),
    });

    await expect(triageRepo.ackItem(item.id, message!.receiptHandle!, "example-user"))
      .resolves.toBe("updated");
    await expect(triageRepo.listItems("triage")).resolves.toEqual([]);
    const stream = await streamsRepo.listMessages("triage", "0");
    expect(stream.map(({ eventName }) => eventName)).toEqual([
      "triage.item.available",
      "triage.item.acked",
    ]);
  });

  test("shared thread ACK deletes every pending message atomically", async () => {
    const first = await enqueue();
    const second = await enqueue();
    const firstClaim = (await queuesRepo.receiveMessages({
      queueId: first.queue.id,
      maxMessages: 10,
      consumerName: "dashboard:career",
    })) ?? [];
    expect(firstClaim).toHaveLength(2);
    for (const message of firstClaim) await triageRepo.storeClaim(claimInput(message));

    const [thread] = await threadsRepo.listThreads("triage");
    expect(thread).toMatchObject({ pendingItemCount: 2, status: "open" });
    await expect(threadsRepo.ackThread(thread!.id, "example-user")).resolves.toBe("updated");
    await expect(threadsRepo.listThreads("triage")).resolves.toEqual([]);
    const remaining = await testPool.query("select count(*)::int as count from queue_messages");
    expect(remaining.rows[0]).toEqual({ count: 0 });
  });
});

describe("retry scheduling", () => {
  test("NACK clears the lease, delays redelivery, and records bounded error metadata", async () => {
    const { queue, message } = await enqueue();
    const [claimed] = await queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "failure-demo",
    }) ?? [];
    await expect(queuesRepo.nackMessage({
      queueId: queue.id,
      messageId: message.id,
      receiptHandle: claimed!.receiptHandle!,
      consumerName: "failure-demo",
      delaySeconds: 17,
      error: "simulated failure",
    })).resolves.toBe(true);
    await expect(queuesRepo.receiveMessages({
      queueId: queue.id,
      maxMessages: 1,
      consumerName: "failure-demo",
    })).resolves.toEqual([]);
    const attempts = await queuesRepo.listAttempts(message.id);
    expect(attempts.at(-1)).toMatchObject({
      outcome: "nacked",
      detail: { error: "simulated failure", delaySeconds: 17 },
    });
  });
});

describe("digest batches", () => {
  test("claims every visible digest message and ACKs the batch", async () => {
    const digest = await queuesRepo.getQueueByName("digest");
    if (!digest) throw new Error("Seeded digest queue is missing");
    const visibleEvent = await eventsRepo.ingestEvent(event());
    const delayedEvent = await eventsRepo.ingestEvent(event());
    await queuesRepo.sendMessage({
      queueId: digest.id,
      eventId: visibleEvent.id,
      delaySeconds: 0,
      messageGroupId: "personal",
      priority: "low",
    });
    await queuesRepo.sendMessage({
      queueId: digest.id,
      eventId: delayedEvent.id,
      delaySeconds: 300,
      messageGroupId: "career",
      priority: "low",
    });

    const claimed = await queuesRepo.claimDigestMessages(digest.id, 300, "digest-scheduler");
    expect(claimed).toHaveLength(1);
    await expect(queuesRepo.ackMessages(claimed!, "digest-scheduler")).resolves.toBe(true);
    await expect(queuesRepo.getStats(digest.id)).resolves.toMatchObject({
      visible: 0,
      delayed: 1,
      inFlight: 0,
    });
  });
});
