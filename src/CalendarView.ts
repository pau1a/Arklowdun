import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import { nowMs, toDate } from "./db/time";

export interface CalendarEvent {
  id: string;
  title: string;
  datetime: number; // timestamp in ms
  reminder?: number; // timestamp in ms
  created_at: number;
  updated_at: number;
}

async function fetchEvents(): Promise<CalendarEvent[]> {
  return await invoke<CalendarEvent[]>("get_events");
}

async function saveEvent(event: Omit<CalendarEvent, "id" | "created_at" | "updated_at">): Promise<CalendarEvent> {
  return await invoke<CalendarEvent>("add_event", { event });
}

function renderMonth(root: HTMLElement, events: CalendarEvent[]) {
  root.innerHTML = "";
  const now = toDate(nowMs());
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const table = document.createElement("table");
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
    cell.innerHTML = `<div class="date">${day}</div>`;
    const cellDate = new Date(year, month, day);
    const dayEvents = events.filter((e) => {
      const a = toDate(e.datetime);
      return (
        a.getFullYear() === cellDate.getFullYear() &&
        a.getMonth() === cellDate.getMonth() &&
        a.getDate() === cellDate.getDate()
      );
    });
    dayEvents.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "event";
      div.textContent = ev.title;
      cell.appendChild(div);
    });
    row.appendChild(cell);
  }
  table.appendChild(row);
  root.appendChild(table);
}

async function scheduleNotifications(events: CalendarEvent[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  const now = nowMs();
  events.forEach((ev) => {
    if (ev.reminder && ev.reminder > now) {
      setTimeout(() => {
        sendNotification({
          title: ev.title,
        body: toDate(ev.datetime).toLocaleString(),
        });
      }, ev.reminder - now);
    }
  });
}

export async function CalendarView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Calendar</h2>
    <div id="calendar"></div>
    <form id="event-form">
      <input id="event-title" type="text" placeholder="Title" required />
      <input id="event-datetime" type="datetime-local" required />
      <button type="submit">Add Event</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const calendarEl = section.querySelector<HTMLElement>("#calendar");
  const form = section.querySelector<HTMLFormElement>("#event-form");
  const titleInput = section.querySelector<HTMLInputElement>("#event-title");
  const dateInput = section.querySelector<HTMLInputElement>("#event-datetime");

  let events = await fetchEvents();
  if (calendarEl) renderMonth(calendarEl, events);
  scheduleNotifications(events);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!titleInput || !dateInput) return;
    const dt = new Date(dateInput.value);
    const ev = await saveEvent({
      title: titleInput.value,
      datetime: dt.getTime(),
      reminder: dt.getTime(),
    });
    events.push(ev);
    if (calendarEl) renderMonth(calendarEl, events);
    scheduleNotifications([ev]);
    form.reset();
  });
}

