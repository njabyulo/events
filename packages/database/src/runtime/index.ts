import { pool } from "../client.js";

export async function pingDatabase(): Promise<void> {
  await pool.query(`select 1
    from events, outbox, queue_messages, stream_messages, replays, dead_letter_messages
    where false`);
}

export async function withDatabaseAdvisoryLock<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  if (!/^[a-z0-9._-]{1,120}$/i.test(name)) {
    throw new Error("Advisory lock name is invalid");
  }
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtext($1), hashtext($2)) as acquired",
      ["events-runtime", name],
    );
    if (!result.rows[0]?.acquired) return { acquired: false };
    try {
      return { acquired: true, value: await operation() };
    } finally {
      await client.query(
        "select pg_advisory_unlock(hashtext($1), hashtext($2))",
        ["events-runtime", name],
      );
    }
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
