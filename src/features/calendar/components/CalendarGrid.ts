import { nowMs } from "../../../db/time";
import type { CalendarEvent } from "../model/CalendarEvent";

export interface CalendarGridOptions {
  getNow?: () => number;
}

export interface CalendarGridInstance {
  element: HTMLDivElement;
  setEvents(events: CalendarEvent[]): void;
}

function renderMonth(root: HTMLElement, events: CalendarEvent[], getNow: () => number): void {
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
      const source = event.start_at_utc ?? event.start_at;
      const parts = fmt.format(new Date(source));
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

  return {
    element,
    setEvents(events: CalendarEvent[]) {
      renderMonth(element, events, getNow);
    },
  };
}

export default CalendarGrid;
