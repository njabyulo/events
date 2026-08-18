import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    agents: "src/agents/index.ts",
    consumers: "src/consumers/index.ts",
    digests: "src/digests/index.ts",
    escalations: "src/escalations/index.ts",
    events: "src/events/events.service.ts",
    gmail: "src/gmail/index.ts",
    maintenance: "src/maintenance/index.ts",
    queues: "src/queues/index.ts",
    routing: "src/routing/index.ts",
    telegram: "src/telegram/index.ts",
    triage: "src/triage/index.ts",
  },
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  treeshake: true,
  dts: {
    sourcemap: true,
  },
  deps: {
    neverBundle: true,
  },
});
