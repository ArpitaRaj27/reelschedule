import type pg from "pg";

/** Append one before/after audit record. Runs inside the caller's transaction. */
export async function writeAudit(
  client: pg.PoolClient,
  entry: {
    actorSub: string;
    via: "rest" | "mcp" | "system";
    action: string;
    entityType: string;
    entityId: string | null;
    before: unknown;
    after: unknown;
    requestId?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (actor_sub, via, action, entity_type, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorSub,
      entry.via,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.requestId ?? null,
    ],
  );
}
