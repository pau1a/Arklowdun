import type { CalendarModelPlaceholder } from "@features/calendar/model/types";

export function useCalendarSnapshot(): CalendarModelPlaceholder {
  return { placeholder: true };
}
