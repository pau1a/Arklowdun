import { getHouseholdIdForCalls } from "../../../db/household";
import { notesRepo } from "@repos/notesRepo";
import type { NotesPage } from "@bindings/NotesPage";

export interface FetchNotesOptions {
  householdId?: string;
  includeDeleted?: boolean;
  categoryIds?: string[];
  afterCursor?: string | null;
  limit?: number;
}

export async function fetchNotes(
  options: FetchNotesOptions = {},
): Promise<NotesPage> {
  const householdId = options.householdId ?? (await getHouseholdIdForCalls());
  const result = await notesRepo.listCursor({
    householdId,
    includeDeleted: options.includeDeleted,
    categoryIds: options.categoryIds,
    afterCursor: options.afterCursor ?? undefined,
    limit: options.limit,
  });
  return result;
}
