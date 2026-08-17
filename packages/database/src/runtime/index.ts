import { pool } from "../client.js";

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
