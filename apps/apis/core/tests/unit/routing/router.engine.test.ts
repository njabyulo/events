import { EventEmitter } from "node:events";
import type { Client } from "pg";
import { afterEach, expect, test, vi } from "vitest";
import { RouterEngine } from "../../../src/runtime/routing/router.engine.js";

class FakeListener extends EventEmitter {
  constructor(private readonly order: string[]) {
    super();
  }

  async connect() {
    this.order.push("connect");
  }

  async query(statement: string) {
    this.order.push(statement);
  }

  async end() {
    this.order.push("end");
  }
}

const engines: RouterEngine[] = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

test("registers LISTEN before its startup backlog scan", async () => {
  const order: string[] = [];
  const listener = new FakeListener(order);
  const engine = new RouterEngine({
    createListener: () => listener as unknown as Client,
    eventsChannel: "events_ready_test",
    pollIntervalMs: 60_000,
    reconnectDelayMs: 60_000,
    drain: vi.fn(async () => {
      order.push("drain");
      return [{ status: "idle" as const }];
    }),
  });
  engines.push(engine);

  engine.start();
  await vi.waitFor(() => expect(order).toContain("drain"));

  expect(order.slice(0, 3)).toEqual([
    "connect",
    "LISTEN \"events_ready_test\"",
    "drain",
  ]);
});

test("a notification schedules another table scan instead of carrying work", async () => {
  const listener = new FakeListener([]);
  const drain = vi.fn(async () => [{ status: "idle" as const }]);
  const engine = new RouterEngine({
    createListener: () => listener as unknown as Client,
    eventsChannel: "events_ready_test",
    pollIntervalMs: 60_000,
    reconnectDelayMs: 60_000,
    drain,
  });
  engines.push(engine);
  engine.start();
  await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));

  listener.emit("notification", { payload: "ignored" });
  await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(2));
});
