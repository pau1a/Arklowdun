import { fetchNotes, type FetchNotesOptions } from "../api/notesApi";
import type { Note } from "../model/Note";

export interface UseNotesResult {
  data: Note[] | null;
  error: unknown;
  isLoading: boolean;
}

export async function useNotes(
  options: FetchNotesOptions = {},
): Promise<UseNotesResult> {
  try {
    const data = await fetchNotes(options);
    return { data, error: null, isLoading: false };
  } catch (error) {
    return { data: null, error, isLoading: false };
  }
}
