import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    events: "src/repos/events/index.ts",
    outbox: "src/repos/outbox/index.ts",
    queues: "src/repos/queues/index.ts",
    runtime: "src/runtime/index.ts",
    routing: "src/repos/routing/index.ts",
    rules: "src/repos/rules/index.ts",
    targets: "src/repos/targets/index.ts",
    triage: "src/repos/triage/index.ts",
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
