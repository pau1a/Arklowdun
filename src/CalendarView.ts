import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";

export interface CalendarEvent {
  id: string;
  title: string;
  datetime: string; // ISO string
  reminder?: number; // timestamp in ms
}

async function fetchEvents(): Promise<CalendarEvent[]> {
  return await invoke<CalendarEvent[]>("get_events");
}

async function saveEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
  return await invoke<CalendarEvent>("add_event", { event });
}

function renderMonth(root: HTMLElement, events: CalendarEvent[]) {
  root.innerHTML = "";
  const now = new Date();
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
    const dateStr = new Date(year, month, day).toISOString().split("T")[0];
    const dayEvents = events.filter((e) => e.datetime.startsWith(dateStr));
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
  const now = Date.now();
  events.forEach((ev) => {
    if (ev.reminder && ev.reminder > now) {
      setTimeout(() => {
        sendNotification({
          title: ev.title,
          body: new Date(ev.datetime).toLocaleString(),
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
      datetime: dt.toISOString(),
      reminder: dt.getTime(),
    });
    events.push(ev);
    if (calendarEl) renderMonth(calendarEl, events);
    scheduleNotifications([ev]);
    form.reset();
  });
}

