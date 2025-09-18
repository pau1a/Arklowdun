import { openDb } from "../../../db/open";
import { defaultHouseholdId } from "../../../db/household";
import type { Note } from "../model/Note";

export interface FetchNotesOptions {
  householdId?: string;
  includeDeleted?: boolean;
}

export async function fetchNotes(options: FetchNotesOptions = {}): Promise<Note[]> {
  const db = await openDb();
  const householdId = options.householdId ?? (await defaultHouseholdId());
  const includeDeleted = options.includeDeleted ?? false;
  const whereClause = includeDeleted
    ? "WHERE household_id = ?"
    : "WHERE household_id = ? AND deleted_at IS NULL";
  const rows = await db.select<Note[]>(
    `SELECT id, text, color, x, y, z, position, household_id, created_at, updated_at, deleted_at
       FROM notes
      ${whereClause}
      ORDER BY COALESCE(z,0) DESC, position, created_at, id`,
    [householdId],
  );
  return rows ?? [];
}
