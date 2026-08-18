import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export const pool = new Pool({
  connectionString,
  max: positiveInteger("DATABASE_POOL_MAX", 10),
  connectionTimeoutMillis: positiveInteger("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
  idleTimeoutMillis: positiveInteger("DATABASE_IDLE_TIMEOUT_MS", 30_000),
  statement_timeout: positiveInteger("DATABASE_STATEMENT_TIMEOUT_MS", 30_000),
  query_timeout: positiveInteger("DATABASE_QUERY_TIMEOUT_MS", 35_000),
  application_name: process.env.DATABASE_APPLICATION_NAME?.trim() || "events-api",
});
pool.on("error", (error) => {
  console.error("Unexpected idle PostgreSQL client error", error);
});

export const db = drizzle({ client: pool });

export type Database = typeof db;
