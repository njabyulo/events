import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    events: "src/repos/events/index.ts",
    outbox: "src/repos/outbox/index.ts",
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
