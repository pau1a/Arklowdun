import { openDb } from "../../../db/open";
import { defaultHouseholdId } from "../../../db/household";
import type { Note } from "../model/Note";

export interface FetchNotesOptions {
  householdId?: string;
  includeDeleted?: boolean;
  categoryIds?: string[];
}

export async function fetchNotes(options: FetchNotesOptions = {}): Promise<Note[]> {
  const db = await openDb();
  const householdId = options.householdId ?? (await defaultHouseholdId());
  const includeDeleted = options.includeDeleted ?? false;
  const categoryIds = (options.categoryIds ?? []).map((id) => id.trim()).filter(Boolean);
  const args: unknown[] = [householdId];
  const whereParts = ["household_id = ?"];
  if (!includeDeleted) {
    whereParts.push("deleted_at IS NULL");
  }
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => "?").join(", ");
    whereParts.push(`(category_id IS NULL OR category_id IN (${placeholders}))`);
    args.push(...categoryIds);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;
  const rows = await db.select<Note[]>(
    `SELECT id, category_id, text, color, x, y, z, position, household_id, created_at, updated_at, deleted_at
       FROM notes
      ${whereClause}
      ORDER BY COALESCE(z,0) DESC, position, created_at, id`,
    args,
  );
  return rows ?? [];
}
