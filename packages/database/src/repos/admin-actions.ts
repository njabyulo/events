import type { Database } from "../client.js";
import { adminActionsTable } from "../schemas/routing.schema.js";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AdminActionInput = {
  actor?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

function jsonSafe(value: Record<string, unknown> | null | undefined) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, child) => (
    typeof child === "bigint" ? String(child) : child
  ))) as Record<string, unknown>;
}

export async function recordAdminAction(
  transaction: DatabaseTransaction,
  input: AdminActionInput,
): Promise<void> {
  await transaction.insert(adminActionsTable).values({
    actor: input.actor?.trim() || "api",
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    reason: input.reason?.trim() || null,
    before: jsonSafe(input.before),
    after: jsonSafe(input.after),
  });
}
