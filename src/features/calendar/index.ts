export { CalendarGrid } from "./components/CalendarGrid";
export type { CalendarGridInstance, CalendarGridOptions } from "./components/CalendarGrid";

export {
  fetchCalendarEvents,
  fetchCalendarDeadlineNotes,
  defaultCalendarWindow,
  calendarWindowAround,
} from "./api/calendarApi";
export type { CalendarQuery, FetchCalendarDeadlineNotesOptions } from "./api/calendarApi";

export type {
  CalendarEvent,
  CalendarWindowRange,
  CalendarDeadlineNote,
} from "./model/CalendarEvent";

export { useCalendar } from "./hooks/useCalendar";
export type { UseCalendarOptions, UseCalendarResult } from "./hooks/useCalendar";
export { useContextNotes } from "./hooks/useContextNotes";
export type { UseContextNotesOptions, UseContextNotesResult } from "./hooks/useContextNotes";
