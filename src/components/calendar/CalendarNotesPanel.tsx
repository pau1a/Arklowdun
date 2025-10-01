import { call } from "@lib/ipc/call";
import type { CalendarEvent } from "@features/calendar";
import { defaultHouseholdId } from "@db/household";
import type { Note } from "@bindings/Note";
import { notesRepo, type NotesListByEntityItem } from "@repos/notesRepo";
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
  let categories = getCategories();
  if (categories.length === 0) {
    const householdId = await defaultHouseholdId();
    const fetched = await categoriesRepo.list({
      householdId,
      orderBy: "position, created_at, id",
      includeHidden: true,
    });
    setCategories(fetched);
    categories = getCategories();
  }
  const isVisible = (category: any) =>
    typeof category.isVisible === "boolean"
      ? category.isVisible
      : category.is_visible === true;

  if (categories.length === 0) {
    try {
      const householdId = await defaultHouseholdId();
      const created = await categoriesRepo.create(householdId, {
        name: "Primary",
        slug: "primary",
        color: "#4F46E5",
        is_visible: true,
      });
      setCategories([created]);
      return created.id;
    } catch {
      return null;
    }
  }
  const firstVisible = categories.find((category) => isVisible(category));
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
  let currentOffset = 0;
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
    const message =
      currentError instanceof Error
        ? currentError.message
        : (typeof currentError === "string" && currentError) || "No notes available.";
    errorMessage.textContent = message;
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
          await notesRepo.unlink({
            householdId: currentHouseholdId,
            noteId: entry.note.id,
            entityType: "event",
            entityId: anchorId,
          });
          currentNotes = currentNotes.filter((candidate) => candidate.note.id !== entry.note.id);
          currentOffset = currentNotes.length;
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
      loadMoreButton.disabled = true;
    }
    try {
      const householdId = currentHouseholdId ?? (await defaultHouseholdId());
      currentHouseholdId = householdId;
      const categories = getCategories();
      const categoriesLoaded = categories.length > 0;
      if (categoriesLoaded && activeCategoryIds.length === 0) {
        currentNotes = [];
        currentOffset = 0;
        hasMore = false;
        renderNotes();
        return;
      }
      const filterIds = categoriesLoaded ? [...activeCategoryIds] : undefined;
      const anchorId = currentAnchorId ?? noteAnchorId(currentEvent);
      const offset = append ? currentOffset : 0;
      const response = await notesRepo.listByEntity({
        householdId,
        entityType: "event",
        entityId: anchorId,
        limit: PANEL_LIMIT,
        offset,
        orderBy: "created_at ASC, id ASC",
        categoryIds: filterIds,
      });
      if (token !== fetchToken) return;
      const mapped: PanelNote[] = (response.items ?? []).map((item: NotesListByEntityItem) => ({
        note: item.note,
        linkId: item.link?.id ?? null,
      }));
      if (append) {
        const existingIds = new Set(currentNotes.map((entry) => entry.note.id));
        const merged = currentNotes.slice();
        mapped.forEach((entry) => {
          if (!existingIds.has(entry.note.id)) {
            merged.push(entry);
          }
        });
        currentNotes = merged;
      } else {
        currentNotes = mapped;
      }
      currentOffset = currentNotes.length;
      hasMore = mapped.length === PANEL_LIMIT;
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
      const householdId = currentHouseholdId ?? (await defaultHouseholdId());
      currentHouseholdId = householdId;
      try {
        await ensureEventPersisted(currentEvent, householdId);
      } catch (error) {
        console.warn("Quick-capture: proceed without event pre-persist", error);
      }
      const anchorId = currentAnchorId ?? noteAnchorId(currentEvent);
      const note = await notesRepo.create(householdId, {
        text,
        color: "#FFF4B8",
        x: 0,
        y: 0,
        category_id: categoryId,
      });
      const link = await notesRepo.link({
        householdId,
        noteId: note.id,
        entityType: "event",
        entityId: anchorId,
      });
      const nextEntries = currentNotes
        .concat({ note, linkId: link.id })
        .sort((a, b) => {
          if (a.note.created_at === b.note.created_at) {
            return a.note.id.localeCompare(b.note.id);
          }
          return a.note.created_at - b.note.created_at;
        });
      currentNotes = nextEntries;
      currentOffset = currentNotes.length;
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
    currentOffset = 0;
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
        const householdId = currentHouseholdId ?? (await defaultHouseholdId());
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
