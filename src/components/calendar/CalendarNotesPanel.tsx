import { call } from "@lib/ipc/call";
import type { CalendarEvent } from "@features/calendar";
import { useContextNotes } from "@features/calendar";
import { defaultHouseholdId } from "@db/household";
import type { Note } from "@bindings/Note";
import type { NoteLink } from "@bindings/NoteLink";
import type { ContextNotesPage } from "@bindings/ContextNotesPage";
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
import { categoriesRepo } from "../../repos";

const PANEL_LIMIT = 20;

type PanelNote = {
  note: Note;
  linkId: string | null;
};

interface LoadOptions {
  cursor?: string | null;
  append?: boolean;
}

export interface CalendarNotesPanelInstance {
  element: HTMLElement;
  setEvent(event: CalendarEvent | null): void;
  destroy(): void;
}

async function ensureEventPersisted(
  event: CalendarEvent,
  householdId: string,
): Promise<void> {
  try {
    await call("event_create", {
      data: {
        id: event.id,
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
  if (categories.length === 0) return null;
  const firstVisible = categories.find((category) => category.isVisible);
  if (firstVisible) return firstVisible.id;
  const primary = categories.find((category) => category.slug === "primary");
  return (primary ?? categories[0] ?? null)?.id ?? null;
}

function mapPageToNotes(page: ContextNotesPage): PanelNote[] {
  const linksByNote = new Map<string, NoteLink>();
  page.links.forEach((link) => {
    linksByNote.set(link.note_id, link);
  });
  return page.notes.map((note) => ({
    note,
    linkId: linksByNote.get(note.id)?.id ?? null,
  }));
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
  emptyState.textContent = "No notes linked to this event.";
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
  let nextCursor: string | null = null;
  let fetchToken = 0;
  let currentError: unknown = null;

  const syncQuickState = () => {
    const disabled = !currentEvent || isSubmitting;
    quickInput.disabled = disabled;
    quickSubmit.disabled = disabled;
  };

  const syncLoadingState = (value: boolean) => {
    isLoading = value;
    loading.hidden = !value;
    loadMoreButton.disabled = value || !nextCursor;
  };

  const syncErrorState = () => {
    if (!currentError) {
      errorSurface.hidden = true;
      return;
    }
    const message =
      currentError instanceof Error
        ? currentError.message
        : (typeof currentError === "string" && currentError) || "Unable to load notes.";
    errorMessage.textContent = message;
    errorSurface.hidden = false;
  };

  const renderNotes = () => {
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
        if (!entry.linkId || !currentHouseholdId) return;
        unlink.disabled = true;
        try {
          await contextNotesRepo.deleteLink(currentHouseholdId, entry.linkId);
          currentNotes = currentNotes.filter((candidate) => candidate.note.id !== entry.note.id);
          renderNotes();
          if (currentNotes.length === 0) {
            emptyState.hidden = false;
          }
        } catch (error) {
          unlink.disabled = false;
          currentError = error;
          syncErrorState();
        }
      });

      item.append(color, body, unlink);
      list.appendChild(item);
    });

    loadMoreWrapper.hidden = !nextCursor;
  };

  const loadNotes = async ({ cursor = null, append = false }: LoadOptions = {}) => {
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
        nextCursor = null;
        renderNotes();
        return;
      }
      const filterIds = categoriesLoaded ? [...activeCategoryIds] : undefined;
      const { data, error } = await useContextNotes({
        eventId: currentEvent.id,
        householdId,
        categoryIds: filterIds,
        cursor,
        limit: PANEL_LIMIT,
      });
      if (token !== fetchToken) return;
      if (error) throw error;
      const page = data ?? { notes: [], links: [], next_cursor: null };
      const mapped = mapPageToNotes(page as ContextNotesPage);
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
      nextCursor = page.next_cursor ?? null;
      renderNotes();
    } catch (error) {
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
    if (!nextCursor) return;
    void loadNotes({ cursor: nextCursor, append: true });
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
      await ensureEventPersisted(currentEvent, householdId);
      const note = await contextNotesRepo.quickCreate({
        householdId,
        entityType: "event",
        entityId: currentEvent.id,
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
          currentEvent.id,
        );
        linkId = link.id;
      } catch (error) {
        currentError = error;
        syncErrorState();
      }
      currentNotes = [{ note, linkId }, ...currentNotes];
      renderNotes();
      emptyState.hidden = currentNotes.length === 0 ? false : true;
      quickInput.value = "";
    } catch (error) {
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
    currentNotes = [];
    nextCursor = null;
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
