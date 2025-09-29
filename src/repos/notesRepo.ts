import { call } from "@lib/ipc/call";
import type { Note } from "@bindings/Note";
import type { NotesPage } from "@bindings/NotesPage";

export interface NotesListCursorOptions {
  householdId: string;
  afterCursor?: string | null;
  limit?: number;
  categoryIds?: string[];
  includeDeleted?: boolean;
}

export interface NotesCreateInput {
  text: string;
  color: string;
  x: number;
  y: number;
  category_id?: string | null;
  position?: number;
  z?: number;
  deadline?: number | null;
  deadline_tz?: string | null;
}

export type NotesUpdateInput = Partial<Omit<NotesCreateInput, "category_id">> & {
  category_id?: string | null;
  deleted_at?: number | null;
};

export const notesRepo = {
  async listCursor(options: NotesListCursorOptions): Promise<NotesPage> {
    const payload: Record<string, unknown> = {
      household_id: options.householdId,
    };
    if (options.afterCursor) payload.after_cursor = options.afterCursor;
    if (options.limit !== undefined) payload.limit = options.limit;
    if (options.categoryIds?.length) payload.category_ids = options.categoryIds;
    if (options.includeDeleted !== undefined) {
      payload.include_deleted = options.includeDeleted;
    }
    return call<NotesPage>("notes_list_cursor", payload);
  },

  async create(householdId: string, input: NotesCreateInput): Promise<Note> {
    const data: Record<string, unknown> = {
      household_id: householdId,
      text: input.text,
      color: input.color,
      x: input.x,
      y: input.y,
    };
    if (input.category_id !== undefined) data.category_id = input.category_id;
    if (input.position !== undefined) data.position = input.position;
    if (input.z !== undefined) data.z = input.z;
    if (input.deadline !== undefined) data.deadline = input.deadline;
    if (input.deadline_tz !== undefined) data.deadline_tz = input.deadline_tz;
    return call<Note>("notes_create", { data });
  },

  async update(
    householdId: string,
    id: string,
    patch: NotesUpdateInput,
  ): Promise<Note> {
    const data: Record<string, unknown> = { ...patch };
    if (patch.deadline === null) data.deadline = null;
    if (patch.deadline_tz === null) data.deadline_tz = null;
    if (patch.category_id !== undefined) data.category_id = patch.category_id;
    return call<Note>("notes_update", {
      id,
      data,
      household_id: householdId,
    });
  },

  async delete(householdId: string, id: string): Promise<void> {
    await call<null>("notes_delete", { household_id: householdId, id });
  },

  async restore(householdId: string, id: string): Promise<Note> {
    return call<Note>("notes_restore", { household_id: householdId, id });
  },
};

export default notesRepo;
