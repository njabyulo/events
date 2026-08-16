import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  treeshake: true,
  deps: {
    neverBundle: true,
  },
});
