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
  calendarWindowAround,
  fetchCalendarDeadlineNotes,
  type CalendarDeadlineNote,
  type CalendarEvent,
  type CalendarGridInstance,
  type CalendarGridOptions,
  useCalendar,
} from "@features/calendar";
import CalendarNotesPanel, {
  type CalendarNotesPanelInstance,
} from "./components/calendar/CalendarNotesPanel";
import {
  actions,
  selectors,
  subscribe,
  getState,
  type EventsSnapshot,
} from "./store/index";
import { emit, on } from "./store/events";
import {
  getActiveCategoryIds,
  getCategories,
  setCategories,
  subscribeActiveCategoryIds,
} from "./store/categories";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import createButton from "@ui/Button";
import createInput from "@ui/Input";
import createTruncationBanner from "@ui/TruncationBanner";
import createErrorBanner from "@ui/ErrorBanner";
import { describeTimekeepingError } from "@utils/timekeepingErrors";

const FILTER_INPUT_DEBOUNCE_MS = 180;
const DEADLINE_FETCH_DEBOUNCE_MS = 160;

export interface CalendarViewOptions {
  initialFocusDate?: Date;
  gridOptions?: CalendarGridOptions;
  createCalendarGrid?: (options: CalendarGridOptions) => CalendarGridInstance;
  createNotesPanel?: () => CalendarNotesPanelInstance;
  calendarLoader?: typeof useCalendar;
  preloadCategories?: () => Promise<void>;
  scheduleNotifications?: (events: CalendarEvent[]) => void | Promise<void>;
}

function normalizeFocusDate(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  normalized.setDate(1);
  return normalized;
}

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

async function scheduleNotificationsInternal(events: CalendarEvent[]) {
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

export async function CalendarView(
  container: HTMLElement,
  options: CalendarViewOptions = {},
) {
  runViewCleanups(container);

  const preloadCategories = options.preloadCategories ?? ensureCategoriesLoaded;
  await preloadCategories();

  const gridFactory = options.createCalendarGrid ?? CalendarGrid;
  const gridOptionOverrides: CalendarGridOptions = options.gridOptions ?? {};
  const notesPanelFactory = options.createNotesPanel ?? CalendarNotesPanel;
  const calendarLoader = options.calendarLoader ?? useCalendar;
  const notify = options.scheduleNotifications ?? scheduleNotificationsInternal;
  let focusDate = normalizeFocusDate(options.initialFocusDate ?? new Date());
  const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  // Helper to compute a normalized focus date from a window range
  type CalendarWindowRange = { start: number; end: number };
  function focusFromWindow(range: CalendarWindowRange): Date {
    const center = new Date(Math.round((range.start + range.end) / 2));
    return normalizeFocusDate(center);
  }

  const section = document.createElement("section");
  section.className = "calendar";

  const header = document.createElement("header");
  header.className = "calendar__header";
  // Header primary content

  const headerContent = document.createElement("div");
  headerContent.className = "calendar__header-primary";
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "All times local";

  const filterLabel = document.createElement("label");
  filterLabel.className = "sr-only";
  filterLabel.htmlFor = "calendar-filter";
  filterLabel.textContent = "Filter calendar events";

  const filterInput = createInput({
    id: "calendar-filter",
    type: "search",
    placeholder: "Filter events",
    ariaLabel: "Filter calendar events",
    className: "calendar__filter-input",
  });

  const filterWrapper = document.createElement("div");
  filterWrapper.className = "calendar__filters";
  filterWrapper.append(filterLabel, filterInput);

  const notesToggle = createButton({
    label: "Show notes",
    variant: "ghost",
    size: "sm",
    className: "calendar__notes-toggle",
    type: "button",
    ariaPressed: false,
  });
  notesToggle.disabled = true;
  headerContent.append(kicker, filterWrapper, notesToggle);

  const nav = document.createElement("div");
  nav.className = "calendar__nav";
  const prevMonthButton = createButton({
    children: "‹",
    className: "calendar__nav-button",
    ariaLabel: "Previous month",
  });
  const monthHeading = document.createElement("h2");
  monthHeading.className = "calendar__month-label";
  const nextMonthButton = createButton({
    children: "›",
    className: "calendar__nav-button",
    ariaLabel: "Next month",
  });
  nav.append(prevMonthButton, monthHeading, nextMonthButton);
  header.append(headerContent, nav);

  const updateMonthHeading = () => {
    monthHeading.textContent = focusDate.toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
  };
  updateMonthHeading();

  const focusFilterControls = () => {
    filterInput.focus();
    filterInput.select();
  };

  let lastRefineButton: HTMLButtonElement | null = null;

  const truncationBanner = createTruncationBanner({
    count: 0,
    hidden: true,
    onDismiss: () => {
      truncationDismissed = true;
      truncationBanner.update({ hidden: true });
    },
    onRefine: () => {
      lastRefineButton = truncationBanner.refineButton;
      focusFilterControls();
    },
    refineLabel: "Refine filters",
    refineAriaLabel: "Refine calendar filters",
  });

  const notesPanel = notesPanelFactory();
  let selectedEvent: CalendarEvent | null = null;
  let notesToggleActive = false;
  let filterValue = "";
  let filterDebounce: number | null = null;
  let deadlineNotes: CalendarDeadlineNote[] = [];
  let notesFetchToken = 0;
  let notesDebounce: number | null = null;
  let activeCategoryIds = getActiveCategoryIds();
  let lastCategorySignature = activeCategoryIds.join("|");

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

  prevMonthButton.addEventListener("click", (event) => {
    event.preventDefault();
    void changeMonth("navigate-prev");
  });

  nextMonthButton.addEventListener("click", (event) => {
    event.preventDefault();
    void changeMonth("navigate-next");
  });

  const handleEventSelect = (event: CalendarEvent | null) => {
    selectedEvent = event;
    notesPanel.setEvent(event);
    notesToggleActive = Boolean(event);
    syncNotesToggle();
  };

  const handleNoteSelect = (entry: CalendarDeadlineNote) => {
    if (!entry?.note?.id) return;
    window.location.hash = `#/notes?noteId=${entry.note.id}`;
  };

  const panel = document.createElement("div");
  panel.className = "card calendar__panel";
  const errorRegion = document.createElement("div");
  errorRegion.className = "calendar__error-region";
  errorRegion.setAttribute("aria-live", "polite");
  errorRegion.setAttribute("aria-atomic", "true");
  errorRegion.hidden = true;
  const calendarGridOptions: CalendarGridOptions = {
    ...gridOptionOverrides,
    onEventSelect: handleEventSelect,
    onNoteSelect: handleNoteSelect,
    getNow: gridOptionOverrides.getNow ?? (() => focusDate.getTime()),
  };
  const calendar = gridFactory(calendarGridOptions);
  calendar.setFocusDate(focusDate);
  calendar.setDeadlineNotes(deadlineNotes);
  const calendarSurface = document.createElement("div");
  calendarSurface.className = "calendar__surface";
  calendarSurface.append(errorRegion, calendar.element);

  // Navigation handled below via async changeMonth(direction)

  const layout = document.createElement("div");
  layout.className = "calendar__layout";
  layout.append(calendarSurface, notesPanel.element);

  panel.append(layout);
  registerViewCleanup(container, () => {
    notesPanel.destroy();
  });
  registerViewCleanup(container, () => {
    if (notesDebounce !== null) {
      window.clearTimeout(notesDebounce);
      notesDebounce = null;
    }
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
  const initialWindow = calendarWindowAround(focusDate.getTime());
  let currentWindow = currentSnapshot?.window ?? initialWindow;
  let truncationDismissed = false;
  let lastTruncationToken: number | null = null;
  let inlineError: ReturnType<typeof createErrorBanner> | null = null;

  const applyDeadlineNotes = (notes: CalendarDeadlineNote[]) => {
    deadlineNotes = [...notes];
    calendar.setDeadlineNotes(deadlineNotes);
  };

  const loadDeadlineNotes = async (
    source: string,
    rangeOverride?: CalendarWindowRange,
  ): Promise<void> => {
    const windowRange = rangeOverride ?? currentWindow ?? calendarWindowAround(focusDate.getTime());
    const token = ++notesFetchToken;
    if (activeCategoryIds.length === 0) {
      applyDeadlineNotes([]);
      return;
    }
    try {
      const notes = await fetchCalendarDeadlineNotes({
        windowRange,
        categoryIds: [...activeCategoryIds],
        viewerTz: viewerTimezone,
      });
      if (token !== notesFetchToken) return;
      applyDeadlineNotes(notes);
    } catch (error) {
      console.error("Failed to load calendar deadline notes", error);
    }
  };

  const scheduleDeadlineRefresh = (
    source: string,
    rangeOverride?: CalendarWindowRange,
  ) => {
    if (notesDebounce !== null) window.clearTimeout(notesDebounce);
    const targetRange = rangeOverride ?? currentWindow ?? calendarWindowAround(focusDate.getTime());
    notesDebounce = window.setTimeout(() => {
      notesDebounce = null;
      void loadDeadlineNotes(source, targetRange);
    }, DEADLINE_FETCH_DEBOUNCE_MS);
  };

  const filterEvents = (events: CalendarEvent[]): CalendarEvent[] => {
    const query = filterValue.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) => event.title.toLowerCase().includes(query));
  };

  const syncTruncationBanner = (filtered: CalendarEvent[]) => {
    const snapshot = currentSnapshot;
    const limit = snapshot?.limit ?? null;
    const truncated = snapshot?.truncated ?? false;
    const token = snapshot?.ts ?? null;
    if (!truncated) {
      updateTruncationNotice(limit ?? filtered.length, false, null);
      return;
    }
    if (limit !== null && filtered.length < limit) {
      updateTruncationNotice(limit, false, null);
      return;
    }
    updateTruncationNotice(limit ?? filtered.length, true, token);
  };

  const applyFilters = () => {
    const items = currentSnapshot?.items ?? [];
    const filtered = filterEvents(items);
    calendar.setEvents(filtered);
    calendar.setDeadlineNotes(deadlineNotes);
    syncTruncationBanner(filtered);
  };

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
      truncationBanner.update({ count, hidden: true });
      truncationDismissed = false;
      lastTruncationToken = null;
      lastRefineButton = null;
      return;
    }
    if (token !== null && token !== lastTruncationToken) {
      truncationDismissed = false;
      lastTruncationToken = token;
    }
    truncationBanner.update({ count, hidden: truncationDismissed });
    if (truncationDismissed) {
      lastRefineButton = null;
    }
  }

  const unsubscribe = subscribe(selectors.events.snapshot, (snapshot) => {
    currentSnapshot = snapshot ?? null;
    if (snapshot?.window) {
      const previousWindow = currentWindow;
      currentWindow = snapshot.window;
      const nextFocus = focusFromWindow(snapshot.window);
      const nextFocusTime = nextFocus.getTime();
      if (nextFocusTime !== focusDate.getTime()) {
        focusDate = nextFocus;
        calendar.setFocusDate(nextFocus);
        updateMonthHeading();
      }
      if (
        !previousWindow ||
        previousWindow.start !== snapshot.window.start ||
        previousWindow.end !== snapshot.window.end
      ) {
        scheduleDeadlineRefresh("window-update", snapshot.window);
      }
    }
    applyFilters();
  });
  registerViewCleanup(container, unsubscribe);

  const stopHousehold = on("household:changed", async () => {
    filterValue = "";
    filterInput.value = "";
    lastRefineButton = null;
    applyFilters();
    await loadEvents("household-change");
  });
  registerViewCleanup(container, stopHousehold);

  const stopCategorySubscription = subscribeActiveCategoryIds((ids) => {
    const signature = ids.join("|");
    if (signature === lastCategorySignature) return;
    activeCategoryIds = [...ids];
    lastCategorySignature = signature;
    scheduleDeadlineRefresh("category-change");
  });
  registerViewCleanup(container, stopCategorySubscription);

  const stopCalendarError = on("calendar:load-error", ({ message, detail }) => {
    showInlineError(message, detail ?? undefined);
  });
  registerViewCleanup(container, stopCalendarError);

  async function changeMonth(direction: "navigate-prev" | "navigate-next"): Promise<void> {
    const delta = direction === "navigate-next" ? 1 : -1;
    const next = new Date(focusDate.getTime());
    next.setMonth(next.getMonth() + delta);
    focusDate = normalizeFocusDate(next);
    calendar.setFocusDate(focusDate);
    updateMonthHeading();
    applyFilters();
    const upcomingWindow = calendarWindowAround(focusDate.getTime());
    scheduleDeadlineRefresh(direction, upcomingWindow);
    await loadEvents(direction);
  }

  const shouldIgnoreNavigationKey = (event: KeyboardEvent): boolean => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  const handleNavigationKey = (event: KeyboardEvent) => {
    if (shouldIgnoreNavigationKey(event)) return;
    if (event.key === "[" || event.code === "BracketLeft") {
      event.preventDefault();
      void changeMonth("navigate-prev");
    } else if (event.key === "]" || event.code === "BracketRight") {
      event.preventDefault();
      void changeMonth("navigate-next");
    }
  };

  window.addEventListener("keydown", handleNavigationKey);
  registerViewCleanup(container, () => {
    window.removeEventListener("keydown", handleNavigationKey);
  });

  async function loadEvents(source: string): Promise<void> {
    try {
      const range = calendarWindowAround(focusDate.getTime());
      const { data, error } = await calendarLoader({ window: range });
      if (error) {
        console.error(error);
        return;
      }
      if (!data) return;
      const { items, window, truncated, limit } = data;
      currentWindow = window;
      clearInlineError();
      const payload = actions.events.updateSnapshot({
        items,
        ts: Date.now(),
        window,
        source,
        truncated,
        limit,
      });
      emit("events:updated", payload);
      void notify(items);
      if (notesDebounce !== null) {
        window.clearTimeout(notesDebounce);
        notesDebounce = null;
      }
      void loadDeadlineNotes(source, window);
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
    applyFilters();
    if (items.length) void notify(items);
    void loadDeadlineNotes("snapshot", currentWindow ?? calendarWindowAround(focusDate.getTime()));
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
    const window = snapshot?.window ?? currentWindow ?? calendarWindowAround(focusDate.getTime());
    currentWindow = window;
    const payload = actions.events.updateSnapshot({
      items: nextItems,
      ts: Date.now(),
      window,
      source: "create",
      truncated: snapshot?.truncated ?? false,
    });
    emit("events:updated", payload);
    void notify([ev]);
    form.reset();
  });

  filterInput.addEventListener("input", () => {
    filterValue = filterInput.value;
    lastRefineButton = null;
    if (filterDebounce !== null) window.clearTimeout(filterDebounce);
    filterDebounce = window.setTimeout(() => {
      filterDebounce = null;
      applyFilters();
    }, FILTER_INPUT_DEBOUNCE_MS);
  });

  filterInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && lastRefineButton) {
      event.preventDefault();
      const target = lastRefineButton;
      lastRefineButton = null;
      window.setTimeout(() => {
        try {
          target.focus();
        } catch {
          /* ignore */
        }
      }, 0);
    }
  });

  filterInput.addEventListener("blur", () => {
    lastRefineButton = null;
  });

  const shouldIgnoreCalendarShortcut = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active) {
      const tag = active.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (active.isContentEditable) return true;
      const role = active.getAttribute("role");
      if (role === "textbox" || role === "combobox") return true;
    }
    if (document.querySelector('[data-ui="modal"]:not([hidden])')) return true;
    if (document.querySelector('[aria-modal="true"]')) return true;
    return false;
  };

  const shortcutHandler = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "/" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (shouldIgnoreCalendarShortcut()) return;
      event.preventDefault();
      lastRefineButton = null;
      focusFilterControls();
    }
  };
  window.addEventListener("keydown", shortcutHandler, { passive: false });
  registerViewCleanup(container, () => {
    window.removeEventListener("keydown", shortcutHandler);
    if (filterDebounce !== null) window.clearTimeout(filterDebounce);
  });
}
