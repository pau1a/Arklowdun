import { nowMs } from "../../../db/time";
import type { CalendarEvent } from "../model/CalendarEvent";

export interface CalendarGridOptions {
  getNow?: () => number;
  onEventSelect?: (event: CalendarEvent | null) => void;
}

export interface CalendarGridInstance {
  element: HTMLDivElement;
  setEvents(events: CalendarEvent[]): void;
  selectEventById(id: string | null): void;
}

function renderMonth(
  root: HTMLElement,
  events: CalendarEvent[],
  getNow: () => number,
  onEventSelect?: (event: CalendarEvent) => void,
  selectedEventId: string | null = null,
): void {
  root.innerHTML = "";
  const now = new Date(getNow());
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const monthLabel = document.createElement("div");
  monthLabel.className = "calendar__month-label";
  monthLabel.textContent = now.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  root.appendChild(monthLabel);

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
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayEvents = events.filter((event) => {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: event.tz || timeZone,
      });
      const parts = fmt.format(new Date(event.start_at_utc));
      const [y, m, d] = parts.split("-").map(Number);
      return (
        y === cellDate.getFullYear() &&
        m - 1 === cellDate.getMonth() &&
        d === cellDate.getDate()
      );
    });
    dayEvents.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "calendar__event";
      div.textContent = ev.title;
      div.tabIndex = 0;
      div.setAttribute("role", "button");
      div.dataset.eventId = ev.id;
      if (selectedEventId === ev.id) {
        div.classList.add("calendar__event--selected");
      }
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
    row.appendChild(cell);
  }
  table.appendChild(row);
  root.appendChild(table);
}

export function CalendarGrid(options: CalendarGridOptions = {}): CalendarGridInstance {
  const element = document.createElement("div");
  element.id = "calendar";
  const getNow = options.getNow ?? nowMs;
  const externalSelect = options.onEventSelect;
  let eventsState: CalendarEvent[] = [];
  let selectedEventId: string | null = null;

  function notify(event: CalendarEvent | null): void {
    if (externalSelect) {
      externalSelect(event);
    }
  }

  function internalSelect(event: CalendarEvent): void {
    selectedEventId = event.id;
    notify(event);
    rerender();
  }

  function rerender(): void {
    renderMonth(element, eventsState, getNow, internalSelect, selectedEventId);
  }

  return {
    element,
    setEvents(events: CalendarEvent[]) {
      eventsState = [...events];
      rerender();
    },
    selectEventById(id: string | null) {
      if (!id) {
        selectedEventId = null;
        notify(null);
        rerender();
        return;
      }
      selectedEventId = id;
      const match = eventsState.find((event) => event.id === id) ?? null;
      if (match) {
        notify(match);
      }
      rerender();
    },
  };
}

export default CalendarGrid;
