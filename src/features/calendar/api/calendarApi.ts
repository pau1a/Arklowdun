import { call } from "@lib/ipc/call";
import { defaultHouseholdId } from "../../../db/household";
import type { EventsListRangeResponse } from "@bindings/EventsListRangeResponse";
import type { CalendarEvent, CalendarWindowRange } from "../model/CalendarEvent";

export interface CalendarQuery {
  items: CalendarEvent[];
  window: CalendarWindowRange;
  truncated: boolean;
  limit: number;
}

function endOfDayMs(date: Date): number {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

export function monthWindowAround(focusMs: number): CalendarWindowRange {
  const focus = new Date(focusMs);
  const start = new Date(focus.getFullYear(), focus.getMonth() - 1, 1);
  const end = new Date(focus.getFullYear(), focus.getMonth() + 2, 0);
  return { start: start.getTime(), end: endOfDayMs(end) };
}

export function defaultCalendarWindow(): CalendarWindowRange {
  return monthWindowAround(Date.now());
}

export async function fetchCalendarEvents(
  windowRange: CalendarWindowRange = defaultCalendarWindow(),
): Promise<CalendarQuery> {
  const householdId = await defaultHouseholdId();
  const { items, truncated, limit } = await call<EventsListRangeResponse>("events_list_range", {
    householdId,
    start: windowRange.start,
    end: windowRange.end,
  });
  return { items, window: windowRange, truncated, limit };
}
