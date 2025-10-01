import type { CalendarEvent } from "@features/calendar";

export type NoteAnchorInput = Pick<CalendarEvent, "id"> &
  Partial<Pick<CalendarEvent, "series_parent_id">>;

export function noteAnchorId(input: NoteAnchorInput): string {
  const parentId = input.series_parent_id?.trim();
  if (parentId) {
    return parentId;
  }

  const id = input.id ?? "";
  const separatorIndex = id.indexOf("::");
  if (separatorIndex !== -1) {
    return id.slice(0, separatorIndex);
  }

  return id;
}

export default noteAnchorId;
