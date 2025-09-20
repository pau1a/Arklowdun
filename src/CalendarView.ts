import { call } from "./api/call";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import { nowMs } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import {
  CalendarGrid,
  defaultCalendarWindow,
  type CalendarEvent,
  useCalendar,
} from "@features/calendar";
import {
  actions,
  selectors,
  subscribe,
  getState,
  type EventsSnapshot,
} from "./store";
import { emit, on } from "./store/events";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import createButton from "@ui/Button";
import createInput from "@ui/Input";
import createTruncationBanner from "@ui/TruncationBanner";

async function saveEvent(
  event: Omit<
    CalendarEvent,
    "id" | "created_at" | "updated_at" | "household_id" | "deleted_at"
  >,
): Promise<CalendarEvent> {
  const hh = await defaultHouseholdId();
  return await call<CalendarEvent>("event_create", {
    data: { ...event, household_id: hh },
  });
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
      body: new Intl.DateTimeFormat(undefined, {
        timeZone: ev.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ev.start_at_utc ?? ev.start_at)),
        });
      }, ev.reminder - now);
    }
  });
}

export async function CalendarView(container: HTMLElement) {
  runViewCleanups(container);

  const section = document.createElement("section");
  section.className = "calendar";

  const header = document.createElement("header");
  header.className = "calendar__header";
  const headerContent = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "Calendar";
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "All times local";
  headerContent.append(title, kicker);
  header.appendChild(headerContent);

  const truncationBanner = createTruncationBanner({
    count: 0,
    hidden: true,
    onDismiss: () => {
      truncationDismissed = true;
      truncationBanner.update({ hidden: true });
    },
  });

  const panel = document.createElement("div");
  panel.className = "card calendar__panel";
  const calendar = CalendarGrid();
  panel.appendChild(calendar.element);

  const form = document.createElement("form");
  form.id = "event-form";
  form.className = "calendar__form";
  form.setAttribute("aria-label", "Create calendar event");

  const titleLabel = document.createElement("label");
  titleLabel.className = "sr-only";
  titleLabel.htmlFor = "event-title";
  titleLabel.textContent = "Event title";
  const titleInput = createInput({
    id: "event-title",
    type: "text",
    placeholder: "Title",
    ariaLabel: "Event title",
    required: true,
  });

  const dateLabel = document.createElement("label");
  dateLabel.className = "sr-only";
  dateLabel.htmlFor = "event-start";
  dateLabel.textContent = "Start time";
  const dateInput = createInput({
    id: "event-start",
    type: "datetime-local",
    ariaLabel: "Start time",
    required: true,
  });

  const submitButton = createButton({
    label: "Add Event",
    variant: "primary",
    type: "submit",
  });

  form.append(titleLabel, titleInput, dateLabel, dateInput, submitButton);

  section.append(header, truncationBanner, panel, form);
  container.innerHTML = "";
  container.appendChild(section);

  let currentSnapshot: EventsSnapshot | null = selectors.events.snapshot(getState());
  let currentWindow = currentSnapshot?.window ?? defaultCalendarWindow();
  let truncationDismissed = false;
  let lastTruncationToken: number | null = null;

  function updateTruncationNotice(
    count: number,
    truncated: boolean,
    token: number | null,
  ) {
    if (!truncated) {
      truncationBanner.update({ hidden: true });
      truncationDismissed = false;
      lastTruncationToken = null;
      return;
    }
    if (token !== null && token !== lastTruncationToken) {
      truncationDismissed = false;
      lastTruncationToken = token;
    }
    truncationBanner.update({ count, hidden: truncationDismissed });
  }

  const unsubscribe = subscribe(selectors.events.snapshot, (snapshot) => {
    currentSnapshot = snapshot ?? null;
    if (snapshot?.window) currentWindow = snapshot.window;
    const items = snapshot?.items ?? [];
    calendar.setEvents(items);
    updateTruncationNotice(items.length, snapshot?.truncated ?? false, snapshot?.ts ?? null);
  });
  registerViewCleanup(container, unsubscribe);

  const stopHousehold = on("household:changed", async () => {
    await loadEvents("household-change");
  });
  registerViewCleanup(container, stopHousehold);

  async function loadEvents(source: string): Promise<void> {
    try {
      const range = defaultCalendarWindow();
      const { data, error } = await useCalendar({ window: range });
      if (error) {
        console.error(error);
        return;
      }
      if (!data) return;
      const { items, window, truncated } = data;
      currentWindow = window;
      const payload = actions.events.updateSnapshot({
        items,
        ts: Date.now(),
        window,
        source,
        truncated,
      });
      emit("events:updated", payload);
      scheduleNotifications(items);
    } catch (err) {
      console.error(err);
    }
  }

  if (currentSnapshot) {
    const items = currentSnapshot.items;
    calendar.setEvents(items);
    updateTruncationNotice(
      items.length,
      currentSnapshot.truncated ?? false,
      currentSnapshot.ts,
    );
    if (items.length) scheduleNotifications(items);
  } else {
    await loadEvents("initial");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dateInput.value) return;
    const dt = new Date(dateInput.value);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ms = dt.getTime();
    const ev = await saveEvent({
      title: titleInput.value,
      start_at: ms,
      end_at: ms,
      start_at_utc: ms,
      end_at_utc: ms,
      tz,
      reminder: ms,
    });
    const snapshot = selectors.events.snapshot(getState());
    const baseItems = snapshot?.items ?? [];
    const nextItems = [...baseItems, ev];
    const window = snapshot?.window ?? currentWindow ?? defaultCalendarWindow();
    currentWindow = window;
    const payload = actions.events.updateSnapshot({
      items: nextItems,
      ts: Date.now(),
      window,
      source: "create",
      truncated: snapshot?.truncated ?? false,
    });
    emit("events:updated", payload);
    scheduleNotifications([ev]);
    form.reset();
  });
}

