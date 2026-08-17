import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    consumers: "src/consumers/index.ts",
    events: "src/events/events.service.ts",
    gmail: "src/gmail/index.ts",
    queues: "src/queues/index.ts",
    routing: "src/routing/index.ts",
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
