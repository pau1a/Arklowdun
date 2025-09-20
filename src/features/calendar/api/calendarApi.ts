import { call } from "../../../api/call";
import { defaultHouseholdId } from "../../../db/household";
import type { EventsListRangeResponse } from "@bindings/EventsListRangeResponse";
import type { CalendarEvent, CalendarWindowRange } from "../model/CalendarEvent";

export interface CalendarQuery {
  items: CalendarEvent[];
  window: CalendarWindowRange;
  truncated: boolean;
}

const WINDOW_SPAN_MS = 365 * 24 * 60 * 60 * 1000;

export function defaultCalendarWindow(): CalendarWindowRange {
  const now = Date.now();
  return { start: now - WINDOW_SPAN_MS, end: now + WINDOW_SPAN_MS };
}

export async function fetchCalendarEvents(
  windowRange: CalendarWindowRange = defaultCalendarWindow(),
): Promise<CalendarQuery> {
  const householdId = await defaultHouseholdId();
  const { items, truncated } = await call<EventsListRangeResponse>("events_list_range", {
    householdId,
    start: windowRange.start,
    end: windowRange.end,
  });
  return { items, window: windowRange, truncated };
}
