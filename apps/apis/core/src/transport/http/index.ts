import { Hono } from "hono";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { pingDatabase } from "database/runtime";
import type { AppEnvironment } from "./middleware/app.types.js";
import { apiErrorHandler, apiNotFoundHandler } from "./middleware/error.handlers.js";
import { eventsRouter } from "./rest/events/events.routes.js";
import { escalationsRouter } from "./rest/escalations/escalations.routes.js";
import { sourcesRouter } from "./rest/sources/sources.routes.js";
import { queuesRouter } from "./rest/queues/queues.routes.js";
import { replaysRouter } from "./rest/routing/replays/replays.routes.js";
import { rulesRouter } from "./rest/routing/rules/rules.routes.js";
import { targetsRouter } from "./rest/routing/targets/targets.routes.js";
import { triageRouter } from "./rest/triage/triage.routes.js";
import { dashboardHtml } from "./rest/triage/dashboard.page.js";
import { threadsRouter } from "./rest/triage/threads.routes.js";
import { sseRouter } from "../sse/sse.routes.js";

type AppRouter = Parameters<Hono<AppEnvironment>["route"]>[1];

export type HttpAppDependencies = {
  readiness: () => Promise<void>;
  dashboard: string;
  routes: {
    events: AppRouter;
    escalations: AppRouter;
    streams: AppRouter;
    sources: AppRouter;
    rules: AppRouter;
    targets: AppRouter;
    queues: AppRouter;
    replays: AppRouter;
    triage: AppRouter;
    threads: AppRouter;
  };
};

const productionDependencies: HttpAppDependencies = {
  readiness: pingDatabase,
  dashboard: dashboardHtml,
  routes: {
    events: eventsRouter,
    escalations: escalationsRouter,
    streams: sseRouter,
    sources: sourcesRouter,
    rules: rulesRouter,
    targets: targetsRouter,
    queues: queuesRouter,
    replays: replaysRouter,
    triage: triageRouter,
    threads: threadsRouter,
  },
};

export function createApp(
  overrides: Partial<Omit<HttpAppDependencies, "routes">> & {
    routes?: Partial<HttpAppDependencies["routes"]>;
  } = {},
): Hono<AppEnvironment> {
  const dependencies: HttpAppDependencies = {
    ...productionDependencies,
    ...overrides,
    routes: { ...productionDependencies.routes, ...overrides.routes },
  };
  const app = new Hono<AppEnvironment>();
  app.use("*", requestId());
  app.use("*", logger());
  app.use("*", secureHeaders());

  app.get("/", (c) => c.json({ name: "events", status: "ok" }));
  app.get("/health/live", (c) => c.json({ status: "ok" }));
  app.get("/health/ready", async (c) => {
    try {
      await dependencies.readiness();
      return c.json({ status: "ready" });
    } catch {
      return c.json({ status: "not_ready" }, 503);
    }
  });
  app.get("/dashboard", (c) => c.html(dependencies.dashboard));

  app.route("/events", dependencies.routes.events);
  app.route("/escalations", dependencies.routes.escalations);
  app.route("/streams", dependencies.routes.streams);
  app.route("/sources", dependencies.routes.sources);
  app.route("/rules", dependencies.routes.rules);
  app.route("/targets", dependencies.routes.targets);
  app.route("/queues", dependencies.routes.queues);
  app.route("/replays", dependencies.routes.replays);
  app.route("/triage", dependencies.routes.triage);
  app.route("/threads", dependencies.routes.threads);

  app.notFound(apiNotFoundHandler);
  app.onError(apiErrorHandler);
  return app;
}

export const app = createApp();
