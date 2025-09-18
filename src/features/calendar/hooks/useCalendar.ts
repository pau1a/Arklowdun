import type { CalendarWindowRange } from "../model/CalendarEvent";
import { defaultCalendarWindow, fetchCalendarEvents, type CalendarQuery } from "../api/calendarApi";

export interface UseCalendarOptions {
  window?: CalendarWindowRange;
}

export interface UseCalendarResult {
  data: CalendarQuery | null;
  error: unknown;
  isLoading: boolean;
}

export async function useCalendar(
  options: UseCalendarOptions = {},
): Promise<UseCalendarResult> {
  try {
    const windowRange = options.window ?? defaultCalendarWindow();
    const data = await fetchCalendarEvents(windowRange);
    return { data, error: null, isLoading: false };
  } catch (error) {
    return { data: null, error, isLoading: false };
  }
}
