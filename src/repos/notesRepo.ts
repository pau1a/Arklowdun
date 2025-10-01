import { call } from "@lib/ipc/call";
import type { Note } from "@bindings/Note";
import type { NoteLink } from "@bindings/NoteLink";
import type {
  NoteLinkList,
  NoteLinkListItem,
} from "@bindings/NoteLinkList";
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

export interface NotesListByEntityOptions {
  householdId: string;
  entityType: "event" | "file";
  entityId: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  categoryIds?: string[];
}

export type NotesListByEntityItem = NoteLinkListItem;
export type NotesListByEntityResult = NoteLinkList;

export interface NotesLinkInput {
  householdId: string;
  noteId: string;
  entityType: "event" | "file";
  entityId: string;
}

export const notesRepo = {
  async listCursor(options: NotesListCursorOptions): Promise<NotesPage> {
    const payload: Record<string, unknown> = {
      householdId: options.householdId,
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
      householdId,
      household_id: householdId,
    });
  },

  async delete(householdId: string, id: string): Promise<void> {
    await call<null>("notes_delete", {
      householdId,
      household_id: householdId,
      id,
    });
  },

  async restore(householdId: string, id: string): Promise<Note> {
    return call<Note>("notes_restore", {
      householdId,
      household_id: householdId,
      id,
    });
  },

  async listByEntity(options: NotesListByEntityOptions): Promise<NotesListByEntityResult> {
    const payload: Record<string, unknown> = {
      householdId: options.householdId,
      household_id: options.householdId,
      entityType: options.entityType,
      entity_type: options.entityType,
      entityId: options.entityId,
      entity_id: options.entityId,
    };
    if (options.limit !== undefined) payload.limit = options.limit;
    if (options.offset !== undefined) payload.offset = options.offset;
    if (options.orderBy) payload.orderBy = options.orderBy;
    if (options.orderBy) payload.order_by = options.orderBy;
    if (options.categoryIds?.length) {
      payload.categoryIds = options.categoryIds;
      payload.category_ids = options.categoryIds;
    }
    return call<NotesListByEntityResult>("note_links_list_by_entity", payload);
  },

  async link(options: NotesLinkInput): Promise<NoteLink> {
    return call<NoteLink>("note_links_create", {
      householdId: options.householdId,
      household_id: options.householdId,
      noteId: options.noteId,
      note_id: options.noteId,
      entityType: options.entityType,
      entity_type: options.entityType,
      entityId: options.entityId,
      entity_id: options.entityId,
    });
  },

  async unlink(options: NotesLinkInput): Promise<void> {
    await call<null>("note_links_unlink_entity", {
      householdId: options.householdId,
      household_id: options.householdId,
      noteId: options.noteId,
      note_id: options.noteId,
      entityType: options.entityType,
      entity_type: options.entityType,
      entityId: options.entityId,
      entity_id: options.entityId,
    });
  },
};

export default notesRepo;
