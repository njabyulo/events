import { closeDatabase } from "../src/runtime/index.js";
import { seedSystemResources } from "./system-resources.seed.js";

try {
  await seedSystemResources();
  console.log("System database resources seeded");
} finally {
  await closeDatabase();
}
