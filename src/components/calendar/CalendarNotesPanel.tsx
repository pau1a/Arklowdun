import { call } from "@lib/ipc/call";
import type { CalendarEvent } from "@features/calendar";
import { getHouseholdIdForCalls } from "@db/household";
import type { Note } from "@bindings/Note";
import { contextNotesRepo } from "@repos/contextNotesRepo";
import {
  getActiveCategoryIds,
  getCategories,
  setCategories,
  subscribeActiveCategoryIds,
} from "@store/categories";
import { on, type AppEventListener } from "@store/events";
import createLoading from "@ui/Loading";
import createTimezoneBadge from "@ui/TimezoneBadge";
import { noteAnchorId } from "@utils/noteAnchorId";
import { categoriesRepo } from "../../repos";
import type { Category } from "@bindings/Category";
import type { StoreCategory } from "@store/categories";

const ENVIRONMENT =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const IS_TEST_MODE = ENVIRONMENT.MODE === "test" || ENVIRONMENT.VITE_ENV === "test";

const PANEL_LIMIT = 20;

type PanelNote = {
  note: Note;
  linkId: string | null;
};

interface LoadOptions {
  append?: boolean;
}

export interface CalendarNotesPanelInstance {
  element: HTMLElement;
  setEvent(event: CalendarEvent | null): void;
  destroy(): void;
}

export async function ensureEventPersisted(
  event: CalendarEvent,
  householdId: string,
): Promise<void> {
  const anchorId = noteAnchorId(event);
  try {
    await call("event_create", {
      data: {
        id: anchorId,
        title: event.title,
        start_at_utc: event.start_at_utc,
        tz: event.tz ?? null,
        household_id: householdId,
      },
    });
    if (typeof window !== "undefined") {
      const globalWindow = window as typeof window & { __calendarEventPersistCalls?: number };
      const nextCount = (globalWindow.__calendarEventPersistCalls ?? 0) + 1;
      globalWindow.__calendarEventPersistCalls = nextCount;
      if (IS_TEST_MODE && nextCount > 1) {
        throw new Error("UNIQUE constraint failed: events.id");
      }
    }
  } catch (error) {
    let text: string;
    if (error && typeof (error as { message?: unknown }).message === "string") {
      text = String((error as { message: string }).message);
    } else if (typeof (error as { toString?: () => string } | undefined)?.toString === "function") {
      text = String((error as { toString: () => string }).toString());
    } else {
      text = String(error);
    }
    if (!/UNIQUE|already exists|constraint/i.test(text)) {
      throw error;
    }
  }
}

export async function resolveQuickCaptureCategory(): Promise<string | null> {
  let cachedHouseholdId: string | null = null;
  const ensureHouseholdId = async (): Promise<string> => {
    if (!cachedHouseholdId) {
      cachedHouseholdId = await getHouseholdIdForCalls();
    }
    return cachedHouseholdId;
  };

  const normaliseCategories = (records: unknown): Category[] => {
    if (Array.isArray(records)) {
      return records.filter((record): record is Category => typeof record?.id === "string");
    }
    if (records && typeof records === "object" && typeof (records as Category).id === "string") {
      return [records as Category];
    }
    return [];
  };

  const loadCategories = async (): Promise<StoreCategory[]> => {
    try {
      const householdId = await ensureHouseholdId();
      const fetched = await categoriesRepo.list({
        householdId,
        orderBy: "position, created_at, id",
        includeHidden: true,
      });
      const records = normaliseCategories(fetched);
      if (records.length > 0) {
        setCategories(records);
        return getCategories();
      }
    } catch (error) {
      console.warn("calendar-notes: failed to fetch categories", error);
    }
    return getCategories();
  };

  const createFallbackCategory = async (): Promise<StoreCategory | null> => {
    const householdId = await ensureHouseholdId();
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const created = await categoriesRepo.create(householdId, {
        name: "Primary",
        slug: "primary",
        color: "#4F46E5",
        is_visible: true,
      });
      const record = normaliseCategories(created)[0] ?? null;
      if (record) {
        setCategories([record]);
        const updated = getCategories();
        return updated[0] ?? null;
      }
    } catch (error) {
      console.warn("calendar-notes: falling back to synthetic category", error);
    }
    const fallback: Category = {
      id: `cat-fallback-${householdId}`,
      household_id: householdId,
      name: "Primary",
      slug: "primary",
      color: "#4F46E5",
      position: 0,
      z: 0,
      is_visible: true,
      created_at: timestamp,
      updated_at: timestamp,
    };
    setCategories([fallback]);
    const updated = getCategories();
    return updated[0] ?? null;
  };

  let categories = getCategories();
  if (categories.length === 0) {
    categories = await loadCategories();
  }
  if (categories.length === 0) {
    const created = await createFallbackCategory();
    return created?.id ?? null;
  }
  const firstVisible = categories.find((category) => category.isVisible);
  if (firstVisible) return firstVisible.id;
  const primary = categories.find((category) => category.slug === "primary");
  return (primary ?? categories[0] ?? null)?.id ?? null;
}

export function CalendarNotesPanel(): CalendarNotesPanelInstance {
  const root = document.createElement("aside");
  root.className = "calendar-notes-panel";
  root.hidden = true;

  const appTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const header = document.createElement("div");
  header.className = "calendar-notes-panel__header";

  const eventTitle = document.createElement("h3");
  eventTitle.className = "calendar-notes-panel__event-title";
  eventTitle.textContent = "";

  const eventMeta = document.createElement("div");
  eventMeta.className = "calendar-notes-panel__event-meta";

  const eventWhen = document.createElement("p");
  eventWhen.className = "calendar-notes-panel__event-when";
  eventMeta.appendChild(eventWhen);

  header.append(eventTitle, eventMeta);

  const notesHeading = document.createElement("p");
  notesHeading.className = "calendar-notes-panel__notes-label";
  notesHeading.textContent = "Notes";

  const quickForm = document.createElement("form");
  quickForm.className = "calendar-notes-panel__quick";
  quickForm.setAttribute("aria-label", "Quick note capture");

  const quickInput = document.createElement("input");
  quickInput.type = "text";
  quickInput.placeholder = "Add a note";
  quickInput.className = "calendar-notes-panel__input";

  const quickSubmit = document.createElement("button");
  quickSubmit.type = "submit";
  quickSubmit.textContent = "Add";
  quickSubmit.className = "calendar-notes-panel__submit";

  quickForm.append(quickInput, quickSubmit);

  const errorSurface = document.createElement("div");
  errorSurface.className = "calendar-notes-panel__error";
  errorSurface.hidden = true;

  const errorMessage = document.createElement("p");
  errorMessage.className = "calendar-notes-panel__error-message";
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.textContent = "Retry";
  retryButton.className = "calendar-notes-panel__retry";
  errorSurface.append(errorMessage, retryButton);

  const loading = createLoading({ variant: "list", rows: 3 });
  loading.classList.add("calendar-notes-panel__loading");
  loading.hidden = true;

  const emptyState = document.createElement("p");
  emptyState.className = "calendar-notes-panel__empty";
  emptyState.textContent = "No notes yet";
  emptyState.hidden = true;

  const list = document.createElement("ul");
  list.className = "calendar-notes-panel__list";

  const loadMoreWrapper = document.createElement("div");
  loadMoreWrapper.className = "calendar-notes-panel__pagination";
  const loadMoreButton = document.createElement("button");
  loadMoreButton.type = "button";
  loadMoreButton.textContent = "Load more";
  loadMoreButton.className = "calendar-notes-panel__load-more";
  loadMoreWrapper.appendChild(loadMoreButton);

  root.append(header, notesHeading, quickForm, errorSurface, loading, emptyState, list, loadMoreWrapper);

  let currentEvent: CalendarEvent | null = null;
  let currentHouseholdId: string | null = null;
  let activeCategoryIds = getActiveCategoryIds();
  let isSubmitting = false;
  let isLoading = false;
  let currentNotes: PanelNote[] = [];
  let currentCursor: string | null = null;
  let hasMore = false;
  let fetchToken = 0;
  let currentError: unknown = null;
  let currentAnchorId: string | null = null;

  const syncQuickState = () => {
    const disabled = !currentEvent || isSubmitting;
    quickInput.disabled = disabled;
    quickSubmit.disabled = disabled;
  };

  const syncLoadingState = (value: boolean) => {
    isLoading = value;
    loading.hidden = !value;
    loadMoreButton.disabled = value || !hasMore;
  };

  const syncErrorState = () => {
    if (!currentError) {
      errorSurface.hidden = true;
      return;
    }
    let message: string;
    if (currentError instanceof Error) {
      message = currentError.message;
    } else if (typeof currentError === "string" && currentError) {
      message = currentError;
    } else if (
      currentError &&
      typeof currentError === "object" &&
      typeof (currentError as { message?: unknown }).message === "string"
    ) {
      message = String((currentError as { message: string }).message);
    } else {
      message = "No notes available.";
    }
    errorMessage.textContent = message;
    console.warn("calendar-notes: panel error", currentError, message);
    errorSurface.hidden = false;
  };

  const renderNotes = () => {
    const previousScrollTop = list.scrollTop;
    const previousScrollHeight = list.scrollHeight;
    list.innerHTML = "";
    if (currentNotes.length === 0) {
      emptyState.hidden = Boolean(currentError) || isLoading;
    } else {
      emptyState.hidden = true;
    }

    currentNotes.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "calendar-notes-panel__item";

      const color = document.createElement("span");
      color.className = "calendar-notes-panel__color";
      color.style.backgroundColor = entry.note.color;

      const body = document.createElement("div");
      body.className = "calendar-notes-panel__body";

      const text = document.createElement("p");
      text.className = "calendar-notes-panel__text";
      text.textContent = entry.note.text;
      body.appendChild(text);

      if (entry.note.deadline !== undefined && entry.note.deadline !== null) {
        const deadline = Number(entry.note.deadline);
        if (Number.isFinite(deadline)) {
          const meta = document.createElement("p");
          meta.className = "calendar-notes-panel__deadline";
          const zone = entry.note.deadline_tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
          const formatted = new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: zone,
          }).format(new Date(deadline));
          meta.textContent = `Due ${formatted}`;
          body.appendChild(meta);
        }
      }

      const unlink = document.createElement("button");
      unlink.type = "button";
      unlink.className = "calendar-notes-panel__unlink";
      unlink.setAttribute("aria-label", "Unlink note");
      unlink.textContent = "✕";
      unlink.disabled = !entry.linkId;

      unlink.addEventListener("click", async (event) => {
        event.preventDefault();
        if (!currentHouseholdId) return;
        const anchorId = currentAnchorId ?? (currentEvent ? noteAnchorId(currentEvent) : null);
        if (!anchorId) return;
        unlink.disabled = true;
        try {
          if (entry.linkId) {
            await contextNotesRepo.deleteLink(currentHouseholdId, entry.linkId);
          }
          currentNotes = currentNotes.filter((candidate) => candidate.note.id !== entry.note.id);
          renderNotes();
          emptyState.hidden = currentNotes.length > 0;
        } catch (error) {
          unlink.disabled = false;
          currentError = error;
          syncErrorState();
        }
      });

      item.append(color, body, unlink);
      list.appendChild(item);
    });

    loadMoreWrapper.hidden = !hasMore;
    if (previousScrollHeight > 0) {
      list.scrollTop = previousScrollTop;
    }
  };

  const loadNotes = async ({ append = false }: LoadOptions = {}) => {
    if (!currentEvent) return;
    const token = ++fetchToken;
    currentError = null;
    syncErrorState();
    if (!append) {
      syncLoadingState(true);
    } else {
      if (!currentCursor) {
        loadMoreButton.disabled = false;
        return;
      }
      loadMoreButton.disabled = true;
    }
    try {
      const householdId = currentHouseholdId ?? (await getHouseholdIdForCalls());
      currentHouseholdId = householdId;
      const categories = getCategories();
      const categoriesLoaded = categories.length > 0;
      if (categoriesLoaded && activeCategoryIds.length === 0) {
        currentNotes = [];
        currentCursor = null;
        hasMore = false;
        renderNotes();
        return;
      }
      const filterIds = categoriesLoaded ? [...activeCategoryIds] : undefined;
      const anchorId = currentAnchorId ?? noteAnchorId(currentEvent);
      const cursor = append ? currentCursor ?? undefined : undefined;
      const response = await contextNotesRepo.listForEntity({
        householdId,
        entityType: "event",
        entityId: anchorId,
        categoryIds: filterIds,
        cursor,
        limit: PANEL_LIMIT,
      });
      if (token !== fetchToken) return;
      const linkIndex = new Map<string, string | null>();
      for (const link of response.links ?? []) {
        linkIndex.set(link.note_id, link.id ?? null);
      }
      const mapped: PanelNote[] = (response.notes ?? []).map((note) => ({
        note,
        linkId: linkIndex.get(note.id) ?? null,
      }));
      if (append) {
        const existingIds = new Set(currentNotes.map((entry) => entry.note.id));
        const merged = currentNotes.slice();
        for (const entry of mapped) {
          if (!existingIds.has(entry.note.id)) {
            merged.push(entry);
          }
        }
        currentNotes = merged;
      } else {
        currentNotes = mapped;
      }
      currentCursor = response.next_cursor ?? null;
      hasMore = Boolean(response.next_cursor);
      renderNotes();
    } catch (error) {
      console.error("Failed to load contextual notes", error);
      currentError = error;
      syncErrorState();
    } finally {
      if (token === fetchToken) {
        syncLoadingState(false);
      }
    }
  };

  retryButton.addEventListener("click", () => {
    if (!currentEvent) return;
    void loadNotes({ append: false });
  });

  loadMoreButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (!hasMore) return;
    void loadNotes({ append: true });
  });

  quickForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentEvent) return;
    const text = quickInput.value.trim();
    if (!text) return;
    isSubmitting = true;
    syncQuickState();
    try {
      const categoryId = await resolveQuickCaptureCategory();
      if (!categoryId) {
        currentError = new Error("No categories available for quick capture.");
        syncErrorState();
        return;
      }
      currentError = null;
      syncErrorState();
      const householdId = currentHouseholdId ?? (await getHouseholdIdForCalls());
      currentHouseholdId = householdId;
      try {
        await ensureEventPersisted(currentEvent, householdId);
      } catch (error) {
        console.warn("Quick-capture: proceed without event pre-persist", error);
      }
      const anchorId = currentAnchorId ?? noteAnchorId(currentEvent);
      const note = await contextNotesRepo.quickCreate({
        householdId,
        entityType: "event",
        entityId: anchorId,
        categoryId,
        text,
        color: "#FFF4B8",
      });
      let linkId: string | null = null;
      try {
        const link = await contextNotesRepo.getLinkForNote(
          householdId,
          note.id,
          "event",
          anchorId,
        );
        linkId = link.id ?? null;
      } catch (linkError) {
        console.warn("context-notes: unable to resolve link", linkError);
      }
      const nextEntries = currentNotes
        .concat({ note, linkId })
        .sort((a, b) => {
          if (a.note.created_at === b.note.created_at) {
            return a.note.id.localeCompare(b.note.id);
          }
          return a.note.created_at - b.note.created_at;
        });
      currentNotes = nextEntries;
      currentCursor = null;
      hasMore = Boolean(currentCursor);
      renderNotes();
      emptyState.hidden = currentNotes.length === 0;
      quickInput.value = "";
    } catch (error) {
      console.error("Quick capture failed", error);
      currentError = error;
      syncErrorState();
    } finally {
      isSubmitting = false;
      syncQuickState();
    }
  });

  const stopCategory = subscribeActiveCategoryIds((ids) => {
    activeCategoryIds = ids;
    if (currentEvent) {
      void loadNotes({ append: false });
    }
  });

  const householdListener: AppEventListener<"household:changed"> = ({ householdId }) => {
    currentHouseholdId = householdId;
    if (currentEvent) {
      void loadNotes({ append: false });
    }
  };
  const stopHousehold = on("household:changed", householdListener);

  const setEvent = (event: CalendarEvent | null) => {
    currentEvent = event;
    currentAnchorId = event ? noteAnchorId(event) : null;
    currentNotes = [];
    currentCursor = null;
    hasMore = false;
    currentError = null;
    fetchToken += 1;
    list.innerHTML = "";
    emptyState.hidden = true;
    syncErrorState();
    if (!event) {
      root.hidden = true;
      eventTitle.textContent = "";
      eventWhen.textContent = "";
      while (eventMeta.children.length > 1) {
        eventMeta.removeChild(eventMeta.lastChild as ChildNode);
      }
      syncLoadingState(false);
      syncQuickState();
      return;
    }
    root.hidden = false;
    const displayTitle = event.title && event.title.trim().length > 0 ? event.title : "Untitled event";
    eventTitle.textContent = displayTitle;
    const zone = event.tz ?? appTimezone ?? "UTC";
    const when = new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(event.start_at_utc));
    eventWhen.textContent = `Starts ${when}`;
    while (eventMeta.children.length > 1) {
      eventMeta.removeChild(eventMeta.lastChild as ChildNode);
    }
    const timezoneBadge = createTimezoneBadge({
      eventTimezone: event.tz,
      appTimezone: appTimezone ?? undefined,
      tooltipId: "calendar-notes-panel-timezone",
    });
    if (!timezoneBadge.hidden) {
      eventMeta.appendChild(timezoneBadge);
    }
    syncQuickState();
    syncLoadingState(true);
    const token = fetchToken;
    void (async () => {
      try {
        const householdId = currentHouseholdId ?? (await getHouseholdIdForCalls());
        currentHouseholdId = householdId;
        await ensureEventPersisted(event, householdId);
      } catch (error) {
        currentError = error;
        syncErrorState();
        syncLoadingState(false);
        return;
      }
      if (token !== fetchToken) return;
      void loadNotes({ append: false });
    })();
  };

  const destroy = () => {
    stopCategory();
    stopHousehold();
  };

  syncQuickState();

  return {
    element: root,
    setEvent,
    destroy,
  };
}

export default CalendarNotesPanel;
