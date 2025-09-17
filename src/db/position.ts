import type { SqlDatabase } from "@lib/ipc/sql";
import { openDb } from "./open";
import { nowMs } from "./time";
import { requireHousehold } from "./household";

export async function renumberPositions(
  table: string,
  householdId: string,
  db?: SqlDatabase,
): Promise<void> {
  const hh = requireHousehold(householdId);
  const conn = db ?? (await openDb());
  await conn.execute(
    `WITH ordered AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at, id) - 1 AS new_pos
       FROM ${table}
       WHERE household_id = ? AND deleted_at IS NULL
     )
     UPDATE ${table}
     SET position = (SELECT new_pos FROM ordered WHERE ordered.id = ${table}.id)
     WHERE id IN (SELECT id FROM ordered)`,
    [hh]
  );
}

export async function reorderPositions(
  table: string,
  householdId: string,
  updates: { id: string; position: number }[],
): Promise<void> {
  const hh = requireHousehold(householdId);
  const db = await openDb();
  await db.execute("BEGIN");
  try {
    const now = nowMs();
    await db.execute(
      `UPDATE ${table} SET position = position + 1000000, updated_at = ?
       WHERE household_id = ? AND deleted_at IS NULL`,
      [now, hh],
    );

    const updateSql = `UPDATE ${table} SET position = ?, updated_at = ?
      WHERE id = ? AND household_id = ?`;
    for (const { id, position } of updates) {
      await db.execute(updateSql, [position, now, id, hh]);
    }

    await renumberPositions(table, hh, db);
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}
