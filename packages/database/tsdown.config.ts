import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    events: "src/repos/events/index.ts",
    outbox: "src/repos/outbox/index.ts",
    routing: "src/repos/routing/index.ts",
    rules: "src/repos/rules/index.ts",
    targets: "src/repos/targets/index.ts",
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
