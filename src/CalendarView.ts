import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import type { Event } from "./models";

async function fetchEvents(): Promise<Event[]> {
  const hh = await defaultHouseholdId();
  return await invoke<Event[]>("events_list_range", {
    householdId: hh,
    start: 0,
    end: Number.MAX_SAFE_INTEGER,
  });
}

async function saveEvent(
  event: Omit<Event, "id" | "created_at" | "updated_at" | "household_id" | "deleted_at">,
): Promise<Event> {
  const hh = await defaultHouseholdId();
  return await invoke<Event>("event_create", {
    data: { ...event, household_id: hh },
  });
}

function renderMonth(root: HTMLElement, events: Event[]) {
  root.innerHTML = "";
  const now = toDate(nowMs());
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
    const dayEvents = events.filter((e) => {
      const a = toDate(e.starts_at);
      return (
        a.getFullYear() === cellDate.getFullYear() &&
        a.getMonth() === cellDate.getMonth() &&
        a.getDate() === cellDate.getDate()
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

async function scheduleNotifications(events: Event[]) {
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
          body: toDate(ev.starts_at).toLocaleString(),
        });
      }, ev.reminder - now);
    }
  });
}

export async function CalendarView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "calendar";
  section.innerHTML = `
    <header class="calendar__header">
      <div>
        <h2>Calendar</h2>
        <p class="kicker">All times local</p>
      </div>
    </header>
    <div class="card calendar__panel">
      <div id="calendar"></div>
    </div>
    <form id="event-form" class="calendar__form">
      <input id="event-title" type="text" placeholder="Title" required />
      <input id="event-start" type="datetime-local" required />
      <button type="submit">Add Event</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const calendarEl = section.querySelector<HTMLElement>("#calendar");
  const form = section.querySelector<HTMLFormElement>("#event-form");
  const titleInput = section.querySelector<HTMLInputElement>("#event-title");
  const dateInput = section.querySelector<HTMLInputElement>("#event-start");

  let events = await fetchEvents();
  if (calendarEl) renderMonth(calendarEl, events);
  scheduleNotifications(events);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!titleInput || !dateInput) return;
    const dt = new Date(dateInput.value);
    const ev = await saveEvent({
      title: titleInput.value,
      starts_at: dt.getTime(),
      reminder: dt.getTime(),
    });
    events.push(ev);
    if (calendarEl) renderMonth(calendarEl, events);
    scheduleNotifications([ev]);
    form.reset();
  });
}

