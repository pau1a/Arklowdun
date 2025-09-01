import { openDb } from "./open";
import { newUuidV7 } from "./id";
import { nowMs } from "./time";

export async function defaultHouseholdId(): Promise<string> {
  const db = await openDb();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM household LIMIT 1",
    []
  );
  if (rows.length > 0) return rows[0].id;

  const id = newUuidV7();
  const now = nowMs();
  await db.execute(
    "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [id, "Default", now, now]
  );
  return id;
}
