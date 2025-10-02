import { nowMs } from "../../../db/time";
import type {
  CalendarDeadlineNote,
  CalendarEvent,
} from "../model/CalendarEvent";

const NOTE_DISPLAY_LIMIT = 5;

export interface CalendarGridOptions {
  getNow?: () => number;
  initialFocus?: number;
  onEventSelect?: (event: CalendarEvent) => void;
  onNoteSelect?: (note: CalendarDeadlineNote) => void;
  noteDisplayLimit?: number;
}

export interface CalendarGridInstance {
  element: HTMLDivElement;
  setEvents(events: CalendarEvent[]): void;
  setDeadlineNotes(notes: CalendarDeadlineNote[]): void;
  setFocusDate(date: Date): void;
  getFocusDate(): Date;
}

type PopoverHandle = {
  dispose: () => void;
};

function noteDayKey(year: number, month: number, day: number): string {
  return `${year}-${month}-${day}`;
}

function firstLine(text: string): string {
  const trimmed = text ?? "";
  const [line] = trimmed.split(/\r?\n/);
  const normalised = line?.trim() ?? "";
  return normalised.length > 0 ? normalised : trimmed.trim();
}

function renderMonth(
  root: HTMLElement,
  eventsByDay: Map<string, CalendarEvent[]>,
  deadlineNotes: CalendarDeadlineNote[],
  focusMs: number,
  noteLimit: number,
  onEventSelect: ((event: CalendarEvent) => void) | undefined,
  onNoteSelect: ((note: CalendarDeadlineNote) => void) | undefined,
  openPopover: (cell: HTMLTableCellElement, notes: CalendarDeadlineNote[]) => void,
  closePopover: () => void,
): void {
  closePopover();
  root.innerHTML = "";
  const focusDate = new Date(focusMs);
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const notesByDay = new Map<string, CalendarDeadlineNote[]>();
  deadlineNotes.forEach((entry) => {
    const key = noteDayKey(entry.displayYear, entry.displayMonth, entry.displayDay);
    const bucket = notesByDay.get(key);
    if (bucket) bucket.push(entry);
    else notesByDay.set(key, [entry]);
  });

  // Events are already normalised into eventsByDay; no per-cell filtering here.

  const table = document.createElement("table");
  table.className = "calendar__table";
  const headerRow = document.createElement("tr");
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => {
    const th = document.createElement("th");
    th.textContent = d;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  let row = document.createElement("tr");
  for (let i = 0; i < firstDay; i++) row.appendChild(document.createElement("td"));
  for (let day = 1; day <= lastDate; day++) {
    if ((firstDay + day - 1) % 7 === 0 && day !== 1) {
      table.appendChild(row);
      row = document.createElement("tr");
    }
    const cell = document.createElement("td");
    cell.tabIndex = 0;
    cell.classList.add("calendar__cell");
    const cellDate = new Date(year, month, day);
    const dateDiv = document.createElement("div");
    dateDiv.className = "calendar__date";
    dateDiv.textContent = String(day);
    const today = new Date();
    if (
      cellDate.getFullYear() === today.getFullYear() &&
      cellDate.getMonth() === today.getMonth() &&
      cellDate.getDate() === today.getDate()
    ) {
      dateDiv.classList.add("calendar__date--today");
    }
    cell.appendChild(dateDiv);

    const dayKey = noteDayKey(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
    const dayEvents = eventsByDay.get(dayKey) ?? [];
    dayEvents.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "calendar__event";
      div.textContent = ev.title;
      div.tabIndex = 0;
      div.setAttribute("role", "button");
      if (onEventSelect) {
        div.addEventListener("click", (event) => {
          event.preventDefault();
          onEventSelect(ev);
        });
        div.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            onEventSelect(ev);
          }
        });
      }
      cell.appendChild(div);
    });

    const key = noteDayKey(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
    const dayNotes = notesByDay.get(key) ?? [];
    const limit = Math.max(1, noteLimit);
    if (dayNotes.length > 0) {
      const visible = dayNotes.slice(0, limit);
      visible.forEach((entry) => {
        const chip = document.createElement("div");
        chip.className = "calendar__note";
        const label = firstLine(entry.note.text ?? "");
        chip.textContent = label || "Untitled note";
        if (entry.note.text) chip.title = entry.note.text.trim();
        chip.tabIndex = 0;
        chip.setAttribute("role", "button");
        if (onNoteSelect) {
          chip.addEventListener("click", (event) => {
            event.preventDefault();
            closePopover();
            onNoteSelect(entry);
          });
          chip.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
              event.preventDefault();
              closePopover();
              onNoteSelect(entry);
            }
          });
        }
        cell.appendChild(chip);
      });
      if (dayNotes.length > limit) {
        const moreButton = document.createElement("button");
        moreButton.type = "button";
        moreButton.className = "calendar__note calendar__note-more";
        moreButton.textContent = `+${dayNotes.length - limit} more`;
        moreButton.addEventListener("click", (event) => {
          event.preventDefault();
          openPopover(cell, dayNotes);
        });
        moreButton.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            openPopover(cell, dayNotes);
          }
        });
        cell.appendChild(moreButton);
      }
    }
    row.appendChild(cell);
  }
  table.appendChild(row);
  root.appendChild(table);
}

export function CalendarGrid(options: CalendarGridOptions = {}): CalendarGridInstance {
  const element = document.createElement("div");
  element.id = "calendar";
  const getNow = options.getNow ?? nowMs;
  const onEventSelect = options.onEventSelect;
  const onNoteSelect = options.onNoteSelect;
  const noteLimit = options.noteDisplayLimit ?? NOTE_DISPLAY_LIMIT;
  let focusMs = normalizeFocusDate(new Date(getNow())).getTime();
  // Events are indexed by display day (year-month-day) to avoid O(days*events)
  // filtering on every render. This dramatically improves month-change perf.
  let currentEvents: CalendarEvent[] = [];
  let currentEventsByDay: Map<string, CalendarEvent[]> = new Map();
  let currentDeadlineNotes: CalendarDeadlineNote[] = [];
  let activePopover: PopoverHandle | null = null;

  const closePopover = () => {
    if (activePopover) {
      activePopover.dispose();
      activePopover = null;
    }
  };

  const openPopover = (cell: HTMLTableCellElement, notes: CalendarDeadlineNote[]) => {
    if (notes.length === 0) return;
    closePopover();
    const popover = document.createElement("div");
    popover.className = "calendar__note-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Deadline notes");
    popover.tabIndex = -1;
    const list = document.createElement("ul");
    list.className = "calendar__note-popover-list";
    notes.forEach((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar__note-popover-item";
      const label = firstLine(entry.note.text ?? "");
      button.textContent = label || "Untitled note";
      if (entry.note.text) button.title = entry.note.text.trim();
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closePopover();
        onNoteSelect?.(entry);
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    popover.appendChild(list);
    cell.style.position = "relative";
    cell.appendChild(popover);
    popover.focus();

    const handleOutside = (event: MouseEvent) => {
      if (!popover.contains(event.target as Node)) {
        closePopover();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover();
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);

    activePopover = {
      dispose: () => {
        document.removeEventListener("mousedown", handleOutside);
        document.removeEventListener("keydown", handleEscape);
        popover.remove();
      },
    };
  };

  const rerender = () => {
    renderMonth(
      element,
      currentEventsByDay,
      currentDeadlineNotes,
      focusMs,
      noteLimit,
      onEventSelect,
      onNoteSelect,
      openPopover,
      closePopover,
    );
  };

  function indexEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
    const byDay = new Map<string, CalendarEvent[]>();
    const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    // Cache formatters per timezone for efficiency
    const formatterByTz = new Map<string, Intl.DateTimeFormat>();
    const getFmt = (tz: string) => {
      const k = tz || defaultZone;
      let fmt = formatterByTz.get(k);
      if (!fmt) {
        fmt = new Intl.DateTimeFormat("en-CA", { timeZone: k });
        formatterByTz.set(k, fmt);
      }
      return fmt;
    };
    for (const ev of events) {
      const fmt = getFmt(ev.tz || defaultZone);
      const parts = fmt.format(new Date(ev.start_at_utc));
      const [y, m, d] = parts.split("-").map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) continue;
      const key = noteDayKey(y, m - 1, d);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(ev);
      else byDay.set(key, [ev]);
    }
    return byDay;
  }

  return {
    element,
    setEvents(events: CalendarEvent[]) {
      currentEvents = [...events];
      currentEventsByDay = indexEventsByDay(currentEvents);
      rerender();
    },
    setDeadlineNotes(notes: CalendarDeadlineNote[]) {
      currentDeadlineNotes = [...notes];
      rerender();
    },
    setFocusDate(date: Date) {
      focusMs = normalizeFocusDate(date).getTime();
      rerender();
    },
    getFocusDate() {
      return new Date(focusMs);
    },
  };
}

export default CalendarGrid;

function normalizeFocusDate(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  normalized.setDate(1);
  return normalized;
}
