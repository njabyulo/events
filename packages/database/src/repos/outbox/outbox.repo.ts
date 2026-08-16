import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, type Database } from "../../client.js";
import type { ClaimedOutboxEvent } from "./outbox.types.js";

export type OutboxRepoDependencies = {
  database: Database;
};

export class OutboxRepo {
  constructor(private readonly dependencies: OutboxRepoDependencies) {}

  async claimPending(
    limit = 10,
    visibilityTimeoutMs = 30_000,
  ): Promise<ClaimedOutboxEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be between 1 and 100");
    }
    if (!Number.isSafeInteger(visibilityTimeoutMs) || visibilityTimeoutMs < 1) {
      throw new RangeError("visibilityTimeoutMs must be a positive integer");
    }

    const leaseToken = randomUUID();
    const result = await this.dependencies.database.transaction(
      async (transaction) => transaction.execute(sql<{
        event_id: number;
        lease_token: string;
        attempts: number;
      }>`
        with candidates as (
          select event_id
          from outbox
          where status in ('pending', 'failed')
            and available_at <= now()
            and (locked_until is null or locked_until <= now())
          order by available_at, event_id
          for update skip locked
          limit ${limit}
        )
        update outbox
        set status = 'processing',
            locked_until = now() + (${visibilityTimeoutMs} * interval '1 millisecond'),
            lease_token = ${leaseToken},
            attempts = attempts + 1
        from candidates
        where outbox.event_id = candidates.event_id
        returning outbox.event_id, outbox.lease_token, outbox.attempts
      `),
    );

    return result.rows.map((row) => ({
      eventId: String(row.event_id),
      leaseToken: String(row.lease_token),
      attempts: Number(row.attempts),
    }));
  }

  async complete(eventId: string, leaseToken: string): Promise<boolean> {
    const result = await this.dependencies.database.execute(sql`
      update outbox
      set status = 'completed',
          locked_until = null,
          lease_token = null,
          completed_at = now(),
          last_error = null
      where event_id = ${eventId}
        and status = 'processing'
        and lease_token = ${leaseToken}::uuid
      returning event_id
    `);

    return result.rowCount === 1;
  }
}

export const createOutboxRepo = (
  options: Partial<OutboxRepoDependencies> = {},
): OutboxRepo => new OutboxRepo({ database: options.database ?? db });

export const outboxRepo = createOutboxRepo();
