import { defaultHouseholdId } from "@db/household";
import type { ContextNotesPage } from "@bindings/ContextNotesPage";
import type { NoteLinkEntityType } from "@bindings/NoteLinkEntityType";
import { contextNotesRepo } from "@repos/contextNotesRepo";

export interface UseContextNotesOptions {
  eventId: string;
  householdId?: string;
  categoryIds?: string[];
  cursor?: string | null;
  limit?: number;
  entityType?: NoteLinkEntityType;
}

export interface UseContextNotesResult {
  data: ContextNotesPage | null;
  error: unknown;
  isLoading: boolean;
}

export async function useContextNotes(
  options: UseContextNotesOptions,
): Promise<UseContextNotesResult> {
  try {
    const householdId = options.householdId ?? (await defaultHouseholdId());
    const entityType: NoteLinkEntityType = options.entityType ?? "event";
    const data = await contextNotesRepo.listForEntity({
      householdId,
      entityType,
      entityId: options.eventId,
      categoryIds: options.categoryIds,
      cursor: options.cursor,
      limit: options.limit,
    });
    return { data, error: null, isLoading: false };
  } catch (error) {
    return { data: null, error, isLoading: false };
  }
}

export default useContextNotes;
