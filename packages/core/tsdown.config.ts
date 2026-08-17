import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    events: "src/events/events.service.ts",
    gmail: "src/gmail/index.ts",
    routing: "src/routing/index.ts",
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
