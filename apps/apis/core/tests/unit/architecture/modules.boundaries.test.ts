import { readdir, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const modulesRoot = new URL("../../../src/modules/", import.meta.url);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return entry.name.endsWith(".ts") ? [url] : [];
  }));
  return nested.flat();
}

describe("application module boundaries", () => {
  test("modules stay independent of HTTP, SSE, and process runtimes", async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles(modulesRoot)) {
      const source = await readFile(file, "utf8");
      if (/from\s+["']hono(?:\/[^"']*)?["']/.test(source)) {
        violations.push(`${file.pathname}: imports Hono`);
      }
      if (/from\s+["'][^"']*(?:transport|runtime)\//.test(source)) {
        violations.push(`${file.pathname}: depends on an inbound adapter or runtime`);
      }
      if (/\.(?:routes?|consumer|scheduler|client)\.ts$/.test(file.pathname)) {
        violations.push(`${file.pathname}: transport/runtime file is inside modules`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("transport code keeps handlers in feature modules", async () => {
    const httpRoot = new URL("../../../src/transport/http/", import.meta.url);
    const misplaced = (await sourceFiles(httpRoot))
      .filter((file) => !file.pathname.includes("/middleware/"))
      .filter((file) => /\.handlers?\.ts$/.test(file.pathname))
      .map((file) => file.pathname);

    expect(misplaced).toEqual([]);
  });
});
