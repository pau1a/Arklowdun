import { call } from "@lib/ipc/call";
import type { ContextNotesPage } from "@bindings/ContextNotesPage";
import type { Note } from "@bindings/Note";
import type { NoteLink } from "@bindings/NoteLink";
import type { NoteLinkEntityType } from "@bindings/NoteLinkEntityType";
import { log } from "@utils/logger";

export interface ListContextNotesOptions {
  householdId: string;
  entityType: NoteLinkEntityType;
  entityId: string;
  categoryIds?: string[];
  cursor?: string | null;
  limit?: number;
}

export interface QuickCreateContextNoteOptions {
  householdId: string;
  entityType: NoteLinkEntityType;
  entityId: string;
  categoryId: string;
  text: string;
  color?: string;
}

export const contextNotesRepo = {
  async listForEntity(options: ListContextNotesOptions): Promise<ContextNotesPage> {
    log.debug("contextual-notes", {
      action: "list",
      entityType: options.entityType,
      entityId: options.entityId,
      cursor: options.cursor,
      limit: options.limit,
    });
    // notes_* commands expect camelCase keys
    const payload: Record<string, unknown> = {
      householdId: options.householdId,
      entityType: options.entityType,
      entityId: options.entityId,
    };
    if (options.categoryIds?.length) payload.categoryIds = options.categoryIds;
    if (options.cursor) payload.cursor = options.cursor;
    if (options.limit !== undefined) payload.limit = options.limit;
    return call<ContextNotesPage>("notes_list_for_entity", payload);
  },

  async quickCreate(options: QuickCreateContextNoteOptions): Promise<Note> {
    log.debug("contextual-notes", {
      action: "quick-create",
      entityType: options.entityType,
      entityId: options.entityId,
    });
    // notes_* commands expect camelCase keys
    return call<Note>("notes_quick_create_for_entity", {
      householdId: options.householdId,
      entityType: options.entityType,
      entityId: options.entityId,
      categoryId: options.categoryId,
      text: options.text,
      color: options.color,
    });
  },

  async getLinkForNote(
    householdId: string,
    noteId: string,
    entityType: NoteLinkEntityType,
    entityId: string,
  ): Promise<NoteLink> {
    log.debug("contextual-notes", {
      action: "get-link",
      entityType,
      entityId,
      noteId,
    });
    return call<NoteLink>("note_links_get_for_note", {
      householdId,
      noteId,
      entityType,
      entityId,
    });
  },

  async deleteLink(householdId: string, linkId: string): Promise<void> {
    log.debug("contextual-notes", { action: "delete-link", linkId });
    await call<null>("note_links_delete", {
      householdId,
      linkId,
    });
  },
};

export default contextNotesRepo;
