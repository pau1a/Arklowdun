import type { NotesModelPlaceholder } from "@features/notes/model/types";

export function useNotesSnapshot(): NotesModelPlaceholder {
  return { placeholder: true };
}
