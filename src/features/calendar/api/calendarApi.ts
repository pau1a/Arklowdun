import { call } from "@lib/ipc/call";
import { getHouseholdIdForCalls } from "../../../db/household";
import type { EventsListRangeResponse } from "@bindings/EventsListRangeResponse";
import type { Note } from "@bindings/Note";
import { notesRepo } from "@repos/notesRepo";
import { log } from "@utils/logger";
import type {
  CalendarDeadlineNote,
  CalendarEvent,
  CalendarWindowRange,
} from "../model/CalendarEvent";

export interface CalendarQuery {
  items: CalendarEvent[];
  window: CalendarWindowRange;
  truncated: boolean;
  limit: number;
}

// Span the window by +/- 45 days around the anchor.
const WINDOW_SPAN_MS = 45 * 24 * 60 * 60 * 1000;

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

export function calendarWindowAround(anchor: number | Date): CalendarWindowRange {
  const center = typeof anchor === "number" ? anchor : anchor.getTime();
  return { start: center - WINDOW_SPAN_MS, end: center + WINDOW_SPAN_MS };
}

export function defaultCalendarWindow(): CalendarWindowRange {
  return calendarWindowAround(Date.now());
}

export async function fetchCalendarEvents(
  windowRange: CalendarWindowRange = defaultCalendarWindow(),
): Promise<CalendarQuery> {
  const householdId = await getHouseholdIdForCalls();
  const { items, truncated, limit } = await call<EventsListRangeResponse>("events_list_range", {
    householdId,
    start: windowRange.start,
    end: windowRange.end,
  });
  return { items, window: windowRange, truncated, limit };
}

const DEADLINE_NOTE_PAGE_LIMIT = 200;
const invalidDeadlineTimezones = new Set<string>();

function resolveDeadlineTimezone(noteTz: string | null | undefined, viewerTz: string): string {
  if (!noteTz) return viewerTz;
  try {
    // Validate timezone; throws RangeError if invalid.
    new Intl.DateTimeFormat("en-CA", { timeZone: noteTz }).format(new Date(0));
    return noteTz;
  } catch (error) {
    if (!invalidDeadlineTimezones.has(noteTz)) {
      invalidDeadlineTimezones.add(noteTz);
      log.warn("calendar-deadline-notes:invalid-timezone", { timezone: noteTz, error });
    }
    return viewerTz;
  }
}

function mapDeadlineNotes(notes: Note[], viewerTz: string): CalendarDeadlineNote[] {
  return notes
    .map((note) => {
      if (note.deadline == null) return null;
      const ms = Number(note.deadline);
      if (!Number.isFinite(ms)) return null;
      const date = new Date(ms);
      const tz = resolveDeadlineTimezone(note.deadline_tz ?? undefined, viewerTz);
      try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const formatted = formatter.format(date);
        const [yearStr, monthStr, dayStr] = formatted.split("-");
        const year = Number(yearStr);
        const month = Number(monthStr) - 1;
        const day = Number(dayStr);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
          return null;
        }
        return {
          note,
          displayYear: year,
          displayMonth: month,
          displayDay: day,
        } as CalendarDeadlineNote;
      } catch (error) {
        log.warn("calendar-deadline-notes:format-error", {
          noteId: note.id,
          error,
        });
        return null;
      }
    })
    .filter((entry): entry is CalendarDeadlineNote => entry !== null);
}

export interface FetchCalendarDeadlineNotesOptions {
  windowRange: CalendarWindowRange;
  categoryIds?: string[];
  viewerTz: string;
}

export async function fetchCalendarDeadlineNotes({
  windowRange,
  categoryIds,
  viewerTz,
}: FetchCalendarDeadlineNotesOptions): Promise<CalendarDeadlineNote[]> {
  if (categoryIds && categoryIds.length === 0) {
    log.debug("calendar-deadline-notes", {
      windowStart: windowRange.start,
      windowEnd: windowRange.end,
      fetched: 0,
      filtered: 0,
    });
    return [];
  }

  const householdId = await getHouseholdIdForCalls();
  const collected: Note[] = [];
  let cursor: string | null | undefined;

  do {
    const page = await notesRepo.listByDeadlineRange({
      householdId,
      startUtc: windowRange.start,
      endUtc: windowRange.end,
      categoryIds,
      cursor: cursor ?? undefined,
      limit: DEADLINE_NOTE_PAGE_LIMIT,
      viewerTz,
    });
    collected.push(...page.items);
    cursor = page.cursor ?? null;
  } while (cursor);

  const mapped = mapDeadlineNotes(collected, viewerTz);
  mapped.sort((a, b) => {
    const aDeadline = Number(a.note.deadline ?? 0);
    const bDeadline = Number(b.note.deadline ?? 0);
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    return a.note.id.localeCompare(b.note.id);
  });

  log.debug("calendar-deadline-notes", {
    windowStart: windowRange.start,
    windowEnd: windowRange.end,
    fetched: collected.length,
    filtered: mapped.length,
  });

  return mapped;
}
