import { call } from "@lib/ipc/call";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import { nowMs } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { categoriesRepo } from "./repos";
import {
  CalendarGrid,
  defaultCalendarWindow,
  type CalendarEvent,
  useCalendar,
} from "@features/calendar";
import CalendarNotesPanel from "./components/calendar/CalendarNotesPanel";
import {
  actions,
  selectors,
  subscribe,
  getState,
  type EventsSnapshot,
} from "./store";
import { emit, on } from "./store/events";
import { getCategories, setCategories } from "./store/categories";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import { getRouteParams, subscribeRouteParams } from "./store/router";
import createButton from "@ui/Button";
import createInput from "@ui/Input";
import createTruncationBanner from "@ui/TruncationBanner";
import createErrorBanner from "@ui/ErrorBanner";
import { describeTimekeepingError } from "@utils/timekeepingErrors";

async function saveEvent(
  event: Omit<
    CalendarEvent,
    "id" | "created_at" | "updated_at" | "household_id" | "deleted_at"
  >,
): Promise<CalendarEvent> {
  const hh = await defaultHouseholdId();
  const safeEvent = { ...event } as Record<string, unknown>;
  delete safeEvent.end_at_utc;
  return await call<CalendarEvent>("event_create", {
    data: { ...safeEvent, household_id: hh },
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
      }).format(new Date(ev.start_at_utc)),
        });
      }, ev.reminder - now);
    }
  });
}

async function ensureCategoriesLoaded(): Promise<void> {
  if (getCategories().length > 0) return;
  try {
    const householdId = await defaultHouseholdId();
    const categories = await categoriesRepo.list({
      householdId,
      orderBy: "position, created_at, id",
      includeHidden: true,
    });
    setCategories(categories);
  } catch (error) {
    console.error("Failed to preload categories for calendar", error);
  }
}

export async function CalendarView(container: HTMLElement) {
  runViewCleanups(container);

  await ensureCategoriesLoaded();

  const section = document.createElement("section");
  section.className = "calendar";

  const header = document.createElement("header");
  header.className = "calendar__header";
  const headerContent = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "All times local";
  headerContent.append(kicker);

  const notesToggle = createButton({
    label: "Show notes",
    variant: "ghost",
    size: "sm",
    className: "calendar__notes-toggle",
    type: "button",
    ariaPressed: false,
  });
  notesToggle.disabled = true;
  headerContent.append(notesToggle);
  header.appendChild(headerContent);

  const truncationBanner = createTruncationBanner({
    count: 0,
    hidden: true,
    onDismiss: () => {
      truncationDismissed = true;
      truncationBanner.update({ hidden: true });
    },
  });

  const notesPanel = CalendarNotesPanel();
  let selectedEvent: CalendarEvent | null = null;
  let notesToggleActive = false;
  let pendingRouteEventId = getRouteParams().eventId;

  const syncNotesToggle = () => {
    const hasEvent = Boolean(selectedEvent);
    notesToggle.disabled = !hasEvent;
    const pressed = hasEvent && notesToggleActive;
    notesToggle.update({
      label: pressed ? "Hide notes" : "Show notes",
      ariaPressed: pressed,
    });
    notesPanel.element.classList.toggle("calendar-notes-panel--mobile-open", pressed);
  };

  notesToggle.addEventListener("click", (event) => {
    event.preventDefault();
    if (!selectedEvent) return;
    notesToggleActive = !notesToggleActive;
    syncNotesToggle();
  });
  syncNotesToggle();

  const handleEventSelect = (event: CalendarEvent | null) => {
    selectedEvent = event;
    notesPanel.setEvent(event);
    notesToggleActive = Boolean(event);
    syncNotesToggle();
  };

  const panel = document.createElement("div");
  panel.className = "card calendar__panel";
  const errorRegion = document.createElement("div");
  errorRegion.className = "calendar__error-region";
  errorRegion.setAttribute("aria-live", "polite");
  errorRegion.setAttribute("aria-atomic", "true");
  errorRegion.hidden = true;
  const calendar = CalendarGrid({ onEventSelect: handleEventSelect });
  const trySelectPendingEvent = (events: CalendarEvent[]) => {
    if (!pendingRouteEventId) return;
    const match = events.find((event) => event.id === pendingRouteEventId);
    if (!match) return;
    calendar.selectEventById(match.id);
    pendingRouteEventId = null;
  };
  const calendarSurface = document.createElement("div");
  calendarSurface.className = "calendar__surface";
  calendarSurface.append(errorRegion, calendar.element);

  const layout = document.createElement("div");
  layout.className = "calendar__layout";
  layout.append(calendarSurface, notesPanel.element);

  panel.append(layout);
  registerViewCleanup(container, () => {
    notesPanel.destroy();
  });

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
  let inlineError: ReturnType<typeof createErrorBanner> | null = null;

  const clearInlineError = () => {
    if (inlineError) {
      inlineError.remove();
      inlineError = null;
    }
    errorRegion.hidden = true;
  };

  const showInlineError = (message: string, detail?: string | null) => {
    if (!inlineError) {
      inlineError = createErrorBanner({
        message,
        detail: detail ?? undefined,
        onDismiss: () => {
          clearInlineError();
        },
      });
      errorRegion.appendChild(inlineError);
    } else {
      inlineError.update({ message, detail: detail ?? undefined });
    }
    errorRegion.hidden = false;
  };

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
    trySelectPendingEvent(items);
    updateTruncationNotice(items.length, snapshot?.truncated ?? false, snapshot?.ts ?? null);
  });
  registerViewCleanup(container, unsubscribe);

  const stopHousehold = on("household:changed", async () => {
    await loadEvents("household-change");
  });
  registerViewCleanup(container, stopHousehold);

  const stopCalendarError = on("calendar:load-error", ({ message, detail }) => {
    showInlineError(message, detail ?? undefined);
  });
  registerViewCleanup(container, stopCalendarError);

  const stopRouteParams = subscribeRouteParams((params) => {
    if (params.eventId) {
      if (selectedEvent?.id === params.eventId) {
        pendingRouteEventId = null;
        return;
      }
      pendingRouteEventId = params.eventId;
      const items = selectors.events.items(getState());
      trySelectPendingEvent(items);
    } else {
      pendingRouteEventId = null;
      calendar.selectEventById(null);
    }
  });
  registerViewCleanup(container, stopRouteParams);

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
      clearInlineError();
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
      const descriptor = describeTimekeepingError(err);
      console.error("Calendar load failed", descriptor.error);
      emit("calendar:load-error", {
        message: descriptor.message,
        detail: descriptor.detail ?? undefined,
      });
    }
  }

  if (currentSnapshot) {
    const items = currentSnapshot.items;
    calendar.setEvents(items);
    trySelectPendingEvent(items);
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
