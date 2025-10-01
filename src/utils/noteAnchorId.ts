import type { CalendarEvent } from "@features/calendar";

// This helper intentionally stays minimal for predictable anchoring semantics.

export type NoteAnchorInput = Pick<CalendarEvent, "id"> &
  Partial<Pick<CalendarEvent, "series_parent_id">>;

export function noteAnchorId(input: NoteAnchorInput): string {
  const parentId = input.series_parent_id;
  if (typeof parentId === "string" && parentId.trim().length > 0) {
    return parentId;
  }

  return input.id ?? "";
}

export default noteAnchorId;
