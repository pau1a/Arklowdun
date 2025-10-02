import type { Event } from "@bindings/Event";
import type { Note } from "@bindings/Note";

export type CalendarEvent = Event;

export interface CalendarWindowRange {
  start: number;
  end: number;
}

export interface CalendarDeadlineNote {
  note: Note;
  displayYear: number;
  displayMonth: number;
  displayDay: number;
}
