// src/NotesView.ts
import { defaultHouseholdId } from "./db/household";
import { showError } from "./ui/errors";
import { NotesList, useNotes, type Note } from "@features/notes";
import { fetchCalendarEvents, type CalendarEvent } from "@features/calendar";
import type { NoteLink } from "@bindings/NoteLink";
import type { Event } from "@bindings/Event";
import {
  actions,
  selectors,
  subscribe,
  getState,
  type NotesSnapshot,
} from "./store/index";
import { emit, on } from "./store/events";
import { getRouteParams, subscribeRouteParams } from "./store/router";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import {
  getActiveCategoryIds,
  getCategories,
  subscribeActiveCategoryIds,
  type StoreCategory,
} from "./store/categories";
import createButton from "@ui/Button";
import createCheckbox from "@ui/Checkbox";
import createInput from "@ui/Input";
import createSelect from "@ui/Select";
import createTimezoneBadge from "@ui/TimezoneBadge";
import { createModal } from "@ui/Modal";
import toast from "@ui/Toast";
import {
  notesRepo,
  type NotesCreateInput,
  type NotesUpdateInput,
} from "./repos/notesRepo";
import { contextNotesRepo, eventsRepo } from "./repos";
import { ensureEventPersisted } from "./components/calendar/CalendarNotesPanel";

const NOTE_PALETTE: Record<string, { base: string; text: string }> = {
  "#FFFF88": { base: "#FFF4B8", text: "#2b2b2b" },
  "#FFF4B8": { base: "#FFF4B8", text: "#2b2b2b" },
  "#CFF7E3": { base: "#CFF7E3", text: "#1f2937" },
  "#DDEBFF": { base: "#DDEBFF", text: "#0f172a" },
  "#FFD9D3": { base: "#FFD9D3", text: "#1f2937" },
  "#EADCF9": { base: "#EADCF9", text: "#1f2937" },
  "#F6EBDC": { base: "#F6EBDC", text: "#1f2937" },
};

const PAGE_SIZE = 20;
const DEFAULT_NOTE_COLOR = "#FFF4B8";

type NewNoteDraft = {
  text: string;
  color: string;
  x: number;
  y: number;
  category_id?: string | null;
  deadline?: number | null;
  deadline_tz?: string | null;
};

export interface NotesViewOptions {
  householdId?: string;
  loadNotes?: typeof useNotes;
  createNote?: (
    householdId: string,
    input: NotesCreateInput,
  ) => Promise<Note>;
  updateNote?: (
    householdId: string,
    id: string,
    patch: NotesUpdateInput,
  ) => Promise<Note>;
  deleteNote?: (householdId: string, id: string) => Promise<void>;
  restoreNote?: (householdId: string, id: string) => Promise<Note>;
}

async function insertNote(
  householdId: string,
  draft: NewNoteDraft,
  create: (
    householdId: string,
    input: NotesCreateInput,
  ) => Promise<Note>,
): Promise<Note> {
  const created = await create(householdId, {
    text: draft.text,
    color: draft.color,
    x: draft.x,
    y: draft.y,
    category_id: draft.category_id ?? null,
    deadline: draft.deadline ?? null,
    deadline_tz: draft.deadline_tz ?? null,
  });
  if (created.z === undefined || created.z === null) {
    created.z = 0;
  }
  return created;
}

async function updateNote(
  householdId: string,
  id: string,
  patch: NotesUpdateInput,
  update: (
    householdId: string,
    id: string,
    patch: NotesUpdateInput,
  ) => Promise<Note>,
): Promise<Note> {
  const updated = await update(householdId, id, patch);
  if (updated.z === undefined || updated.z === null) {
    updated.z = 0;
  }
  return updated;
}

export async function NotesView(
  container: HTMLElement,
  options: NotesViewOptions = {},
) {
  runViewCleanups(container);

  const section = document.createElement("section");

  const form = document.createElement("form");
  form.id = "note-form";
  form.setAttribute("aria-label", "Create note");

  const textLabel = document.createElement("label");
  textLabel.className = "sr-only";
  textLabel.htmlFor = "note-text";
  textLabel.textContent = "Note text";
  const textInput = createInput({
    id: "note-text",
    type: "text",
    placeholder: "Note",
    ariaLabel: "Note text",
    required: true,
  });

  const colorLabel = document.createElement("label");
  colorLabel.className = "sr-only";
  colorLabel.htmlFor = "note-color";
  colorLabel.textContent = "Note color";
  const colorInput = createInput({
    id: "note-color",
    type: "color",
    value: DEFAULT_NOTE_COLOR,
    ariaLabel: "Note color",
  });

  const submitButton = createButton({
    label: "Add",
    variant: "primary",
    type: "submit",
  });

  form.append(textLabel, textInput, colorLabel, colorInput, submitButton);

  const notesBoard = NotesList();
  const canvas = notesBoard.element;

  const pagination = document.createElement("div");
  pagination.className = "notes__pagination";
  const loadMoreButton = createButton({
    label: "Load more",
    variant: "secondary",
    type: "button",
  });
  pagination.appendChild(loadMoreButton);
  pagination.hidden = true;

  const deadlinesPanel = document.createElement("section");
  deadlinesPanel.className = "notes__deadline-panel";
  deadlinesPanel.setAttribute("aria-labelledby", "notes-deadlines-heading");
  deadlinesPanel.hidden = true;

  const deadlinesHeading = document.createElement("h3");
  deadlinesHeading.id = "notes-deadlines-heading";
  deadlinesHeading.textContent = "Deadlines";

  const deadlinesList = document.createElement("ul");
  deadlinesList.className = "notes__deadline-list";
  deadlinesPanel.append(deadlinesHeading, deadlinesList);

  const filters = document.createElement("div");
  filters.className = "notes__filters";
  const linkedLabel = document.createElement("label");
  linkedLabel.className = "notes__filters-option";
  const linkedCheckbox = createCheckbox({
    className: "notes__filters-checkbox",
    ariaLabel: "Show only notes linked to events",
  });
  const linkedText = document.createElement("span");
  linkedText.textContent = "Show only notes linked to events";
  linkedLabel.append(linkedCheckbox, linkedText);
  filters.appendChild(linkedLabel);

  section.append(form, filters, canvas, pagination);
  section.append(deadlinesPanel);
  container.innerHTML = "";
  container.appendChild(section);

  linkedCheckbox.addEventListener("change", async () => {
    if (linkedCheckbox.checked) {
      linkedCheckbox.disabled = true;
      try {
        await hydrateLinksForNotes(notesLocal);
        filterLinkedOnly = true;
      } finally {
        linkedCheckbox.disabled = false;
      }
    } else {
      filterLinkedOnly = false;
    }
    render();
  });

  const quickTextInput = createInput({
    id: "quick-capture-text",
    type: "text",
    ariaLabel: "Quick capture note text",
    required: true,
    placeholder: "Add a note",
  });

  const quickCategorySelect = createSelect({
    id: "quick-capture-category",
    ariaLabel: "Note category",
  });

  const quickDeadlineInput = createInput({
    id: "quick-capture-deadline",
    type: "datetime-local",
    ariaLabel: "Note deadline",
  });

  const quickCaptureModal = createModal({
    open: false,
    onOpenChange: (open) => {
      if (!open) {
        quickCaptureModal.setOpen(false);
      }
    },
    titleId: "quick-capture-title",
    initialFocus: () => quickTextInput,
  });
  const quickDialog = quickCaptureModal.dialog;
  quickDialog.classList.add("notes__quick-capture-dialog");
  const quickTitle = document.createElement("h2");
  quickTitle.id = "quick-capture-title";
  quickTitle.textContent = "Quick capture note";

  const quickForm = document.createElement("form");
  quickForm.className = "notes__quick-capture-form";

  const quickTextLabel = document.createElement("label");
  quickTextLabel.htmlFor = "quick-capture-text";
  quickTextLabel.textContent = "Note";

  const quickCategoryLabel = document.createElement("label");
  quickCategoryLabel.htmlFor = "quick-capture-category";
  quickCategoryLabel.textContent = "Category";

  const quickDeadlineLabel = document.createElement("label");
  quickDeadlineLabel.htmlFor = "quick-capture-deadline";
  quickDeadlineLabel.textContent = "Deadline";

  const quickSubmit = createButton({
    label: "Capture",
    variant: "primary",
    type: "submit",
  });

  quickForm.append(
    quickTextLabel,
    quickTextInput,
    quickCategoryLabel,
    quickCategorySelect,
    quickDeadlineLabel,
    quickDeadlineInput,
    quickSubmit,
  );

  quickDialog.append(quickTitle, quickForm);

  registerViewCleanup(container, () => {
    if (quickCaptureModal.isOpen()) quickCaptureModal.setOpen(false);
    if (quickCaptureModal.root.parentElement) {
      quickCaptureModal.root.remove();
    }
  });

  const useNotesFn = options.loadNotes ?? useNotes;
  const createNoteFn = options.createNote ?? notesRepo.create;
  const updateNoteFn = options.updateNote ?? notesRepo.update;
  const deleteNoteFn = options.deleteNote ?? notesRepo.delete;
  const restoreNoteFn = options.restoreNote ?? notesRepo.restore;

  let householdId =
    options.householdId ??
    (await defaultHouseholdId().catch(() => "default"));
  let activeCategoryIds = getActiveCategoryIds();
  let lastCategorySignature = activeCategoryIds.join("|");
  let categoriesLoaded = getCategories().length > 0;
  let nextCursor: string | null = null;
  let isLoading = false;

  const cloneNotes = (items: Note[]): Note[] => items.map((note) => ({ ...note }));
  const mergeNotes = (current: Note[], incoming: Note[]): Note[] => {
    const map = new Map<string, Note>();
    current.forEach((note) => map.set(note.id, { ...note }));
    incoming.forEach((note) => map.set(note.id, { ...note }));
    return Array.from(map.values());
  };
  let notesLocal: Note[] = cloneNotes(selectors.notes.items(getState()));
  const appTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const noteLinkCache = new Map<string, NoteLink[]>();
  const linkFetches = new Map<string, Promise<NoteLink[]>>();
  const eventCache = new Map<string, Event | null>();
  let filterLinkedOnly = false;
  let highlightedNoteId = getRouteParams().noteId;
  let pendingScrollNoteId = highlightedNoteId;

  const filterVisibleNotes = (notes: Note[]): Note[] => {
    const base = notes.filter((note) => !note.deleted_at);
    if (!categoriesLoaded) {
      return base;
    }
    if (activeCategoryIds.length === 0) {
      return [];
    }
    const allowed = new Set(activeCategoryIds);
    const categoryFiltered = base.filter((note) => {
      if (!note.category_id) return false;
      return allowed.has(note.category_id);
    });
    if (!filterLinkedOnly) return categoryFiltered;
    return categoryFiltered.filter((note) => {
      const links = noteLinkCache.get(note.id);
      if (!links) return false;
      return links.some((link) => link.entity_id && link.entity_type === "event");
    });
  };

  const updateLoadMoreState = () => {
    const hasMore = Boolean(nextCursor);
    pagination.hidden = !hasMore;
    loadMoreButton.disabled = !hasMore || isLoading;
  };

  const getEventLinkForNote = (noteId: string): NoteLink | null => {
    const links = noteLinkCache.get(noteId);
    if (!links) return null;
    return links.find((link) => link.entity_type === "event") ?? null;
  };

  const EVENT_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
  const EVENT_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;
  let cachedLinkableEvents: CalendarEvent[] | null = null;

  const ensureLinksForNote = async (noteId: string): Promise<NoteLink[]> => {
    if (noteLinkCache.has(noteId)) {
      return noteLinkCache.get(noteId)!;
    }
    const existing = linkFetches.get(noteId);
    if (existing) return existing;
    const promise = (async () => {
      try {
        const links = await contextNotesRepo.listLinksForNote(householdId, noteId);
        noteLinkCache.set(noteId, links);
        return links;
      } catch (error) {
        console.error("Failed to load note links", { noteId, error });
        noteLinkCache.set(noteId, []);
        return [];
      } finally {
        linkFetches.delete(noteId);
      }
    })();
    linkFetches.set(noteId, promise);
    return promise;
  };

  const hydrateLinksForNotes = async (notes: Note[]): Promise<void> => {
    await Promise.all(notes.map((note) => ensureLinksForNote(note.id)));
  };

  const loadEventMetadata = async (eventId: string): Promise<Event | null> => {
    if (eventCache.has(eventId)) {
      return eventCache.get(eventId) ?? null;
    }
    try {
      const event = await eventsRepo.get(householdId, eventId);
      eventCache.set(eventId, event);
      return event;
    } catch (error) {
      console.error("Failed to load event", { eventId, error });
      eventCache.set(eventId, null);
      return null;
    }
  };

  const formatEventStart = (event: Event): string => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: appTimezone,
    });
    return formatter.format(new Date(event.start_at_utc));
  };

  const navigateToCalendar = (eventId: string): void => {
    window.location.hash = `#/calendar?eventId=${encodeURIComponent(eventId)}`;
  };

  const loadLinkableEvents = async (): Promise<CalendarEvent[]> => {
    if (cachedLinkableEvents) return cachedLinkableEvents;
    try {
      const now = Date.now();
      const range = {
        start: now - EVENT_LOOKBACK_MS,
        end: now + EVENT_LOOKAHEAD_MS,
      };
      const { items } = await fetchCalendarEvents(range);
      const sorted = [...items].sort((a, b) => a.start_at_utc - b.start_at_utc);
      cachedLinkableEvents = sorted;
      sorted.forEach((event) => {
        eventCache.set(event.id, event);
      });
      return sorted;
    } catch (error) {
      console.error("Failed to load events for linking", error);
      toast.show({
        kind: "error",
        message: "Unable to load events. Try again shortly.",
      });
      return [];
    }
  };

  const openEventPicker = async (note: Note): Promise<void> => {
    const overlay = document.createElement("div");
    overlay.className = "note-linker";
    const panel = document.createElement("div");
    panel.className = "note-linker__panel";
    overlay.appendChild(panel);

    const title = document.createElement("h3");
    title.className = "note-linker__title";
    title.textContent = "Link note to event";
    panel.appendChild(title);

    const description = document.createElement("p");
    description.className = "note-linker__description";
    description.textContent = "Select a recent or upcoming event to link this note.";
    panel.appendChild(description);

    const searchInput = createInput({
      type: "search",
      placeholder: "Search events",
      ariaLabel: "Search events",
      className: "note-linker__search", // apply custom style
    });
    panel.appendChild(searchInput);

    const list = document.createElement("ul");
    list.className = "note-linker__list";
    panel.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "note-linker__footer";
    const cancelButton = createButton({ label: "Cancel", variant: "ghost", type: "button" });
    const confirmButton = createButton({ label: "Link", variant: "primary", type: "button" });
    confirmButton.disabled = true;
    footer.append(cancelButton, confirmButton);
    panel.appendChild(footer);

    document.body.appendChild(overlay);

    const events = await loadLinkableEvents();
    let filteredEvents = [...events];
    let selectedEventId = getEventLinkForNote(note.id)?.entity_id ?? null;
    if (selectedEventId) {
      confirmButton.disabled = false;
    }

    const renderList = () => {
      list.innerHTML = "";
      if (filteredEvents.length === 0) {
        const empty = document.createElement("li");
        empty.className = "note-linker__empty";
        empty.textContent = "No events match your search.";
        list.appendChild(empty);
        return;
      }
      filteredEvents.forEach((event) => {
        const item = document.createElement("li");
        item.className = "note-linker__item";
        const optionId = `note-linker-${note.id}-${event.id}`;

        const radio = createInput({
          type: "radio",
          name: `note-linker-${note.id}`,
          id: optionId,
          className: "note-linker__radio",
        });
        radio.value = event.id;
        radio.checked = selectedEventId === event.id;
        radio.addEventListener("change", () => {
          selectedEventId = event.id;
          confirmButton.disabled = false;
        });

        const label = document.createElement("label");
        label.className = "note-linker__option";
        label.htmlFor = optionId;

        const title = document.createElement("span");
        title.className = "note-linker__option-title";
        title.textContent = event.title?.trim() || "Untitled event";

        const meta = document.createElement("span");
        meta.className = "note-linker__option-meta";
        meta.textContent = formatEventStart(event);

        const badge = createTimezoneBadge({
          eventTimezone: event.tz,
          appTimezone,
          tooltipId: `note-linker-${event.id}-tz`,
          className: "note-linker__option-badge",
        });
        if (!badge.hidden) {
          meta.appendChild(badge);
        }

        label.append(title, meta);
        item.append(radio, label);
        list.appendChild(item);
      });
    };

    const filterEvents = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) {
        filteredEvents = [...events];
      } else {
        filteredEvents = events.filter((event) =>
          (event.title ?? "").toLowerCase().includes(q),
        );
      }
      if (selectedEventId && !filteredEvents.some((event) => event.id === selectedEventId)) {
        selectedEventId = null;
        confirmButton.disabled = true;
      }
      renderList();
    };

    renderList();

    const close = () => {
      overlay.remove();
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });

    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      close();
    });

    confirmButton.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!selectedEventId) return;
      confirmButton.disabled = true;
      confirmButton.update({ label: "Linking…" });
      try {
        const target = events.find((candidate) => candidate.id === selectedEventId);
        if (!target) {
          throw new Error("Selected event not found");
        }
        try {
          await ensureEventPersisted(target, householdId);
        } catch (err) {
          console.warn("Failed to ensure event persisted before linking", err);
        }
        const link = await contextNotesRepo.createLink(
          householdId,
          note.id,
          "event",
          target.id,
        );
        const existing = noteLinkCache.get(note.id) ?? [];
        const nextLinks = [link, ...existing.filter((entry) => entry.id !== link.id)];
        noteLinkCache.set(note.id, nextLinks);
        eventCache.set(target.id, target);
        render();
        close();
      } catch (error) {
        console.error("Failed to link note to event", error);
        toast.show({ kind: "error", message: "Link failed. Try again." });
        confirmButton.disabled = false;
        confirmButton.update({ label: "Link" });
      }
    });

    searchInput.addEventListener("input", (event) => {
      filterEvents((event.target as HTMLInputElement).value ?? "");
    });

    requestAnimationFrame(() => {
      searchInput.focus();
    });
  };

  const unlinkEvent = async (
    note: Note,
    link: NoteLink,
    button: HTMLButtonElement,
  ): Promise<void> => {
    button.disabled = true;
    try {
      await contextNotesRepo.deleteLink(householdId, link.id);
      const existing = noteLinkCache.get(note.id) ?? [];
      noteLinkCache.set(
        note.id,
        existing.filter((entry) => entry.id !== link.id),
      );
      render();
    } catch (error) {
      console.error("Failed to unlink event", error);
      toast.show({ kind: "error", message: "Unlink failed. Try again." });
      button.disabled = false;
    }
  };

  const refreshQuickCaptureCategories = () => {
    const categories = getCategories();
    categoriesLoaded = categories.length > 0;
    const options = categories.map((category: StoreCategory) => ({
      value: category.id,
      label: category.isVisible ? category.name : `${category.name} (hidden)`,
    }));
    if (options.length === 0) {
      options.push({ value: "", label: "Primary" });
    }
    quickCategorySelect.update({ options });
    const preferred = activeCategoryIds[0] ?? options[0]?.value ?? "";
    quickCategorySelect.value = preferred ?? "";
  };

  const renderDeadlines = (notes: Note[]): void => {
    const upcoming = filterVisibleNotes(notes)
      .filter((note) => note.deadline !== undefined && note.deadline !== null)
      .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0));

    deadlinesList.innerHTML = "";
    if (upcoming.length === 0) {
      deadlinesPanel.hidden = true;
      return;
    }

    deadlinesPanel.hidden = false;

    upcoming.forEach((note) => {
      const item = document.createElement("li");
      item.className = "notes__deadline-item";

      const title = document.createElement("span");
      title.className = "notes__deadline-title";
      title.textContent = note.text;

      const meta = document.createElement("div");
      meta.className = "notes__deadline-meta";

      const zone = note.deadline_tz ?? appTimezone ?? "UTC";
      const dueMs = Number(note.deadline);
      if (!Number.isFinite(dueMs)) return;
      const formatted = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      }).format(new Date(dueMs));
      const dueLabel = document.createElement("span");
      dueLabel.textContent = `Due ${formatted}`;
      meta.appendChild(dueLabel);

      const badge = createTimezoneBadge({
        eventTimezone: note.deadline_tz,
        appTimezone,
        tooltipId: `note-deadline-${note.id}-timezone`,
      });
      if (!badge.hidden) {
        meta.appendChild(badge);
      }

      item.append(title, meta);
      deadlinesList.appendChild(item);
    });
  };

  renderDeadlines(notesLocal);

  let suppressNextRender = false;

  const saveSoon = (() => {
    let t: number | undefined;
    return (fn: () => void) => {
      if (t) clearTimeout(t);
      t = window.setTimeout(fn, 200);
    };
  })();

  const commitSnapshot = (
    source: string,
    emitEvent: boolean,
    suppressRender = false,
  ): void => {
    if (suppressRender) suppressNextRender = true;
    const payload = actions.notes.updateSnapshot({
      items: cloneNotes(notesLocal),
      ts: Date.now(),
      source,
      activeCategoryIds: [...activeCategoryIds],
    });
    if (emitEvent) emit("notes:updated", payload);
    renderDeadlines(notesLocal);
  };

  async function reload(source: string): Promise<void> {
    if (categoriesLoaded && activeCategoryIds.length === 0) {
      notesLocal = [];
      nextCursor = null;
      commitSnapshot(source, true, true);
      render();
      updateLoadMoreState();
      return;
    }

    try {
      isLoading = true;
      updateLoadMoreState();
      const categoryIds = categoriesLoaded && activeCategoryIds.length > 0
        ? [...activeCategoryIds]
        : undefined;
      const result = await useNotesFn({
        householdId,
        categoryIds,
        limit: PAGE_SIZE,
      });
      if (result.error) throw result.error;
      const page = result.data;
      notesLocal = cloneNotes(page?.notes ?? []);
      await hydrateLinksForNotes(notesLocal);
      nextCursor = page?.next_cursor ?? null;
      commitSnapshot(source, true, true);
      render();
    } catch (err) {
      showError(err);
    } finally {
      isLoading = false;
      updateLoadMoreState();
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    try {
      isLoading = true;
      updateLoadMoreState();
      const categoryIds = categoriesLoaded && activeCategoryIds.length > 0
        ? [...activeCategoryIds]
        : undefined;
      const result = await useNotesFn({
        householdId,
        categoryIds,
        afterCursor: nextCursor,
        limit: PAGE_SIZE,
      });
      if (result.error) throw result.error;
      const page = result.data;
      const incoming = page?.notes ?? [];
      await hydrateLinksForNotes(incoming);
      notesLocal = mergeNotes(notesLocal, incoming);
      nextCursor = page?.next_cursor ?? null;
      commitSnapshot("notes:load-more", true, true);
      render();
    } catch (err) {
      showError(err);
    } finally {
      isLoading = false;
      updateLoadMoreState();
    }
  }

  loadMoreButton.addEventListener("click", (event) => {
    event.preventDefault();
    void loadMore();
  });

  function render() {
    notesBoard.clear();
    const visible = filterVisibleNotes(notesLocal);
    visible
      .sort((a, b) =>
        (b.z ?? 0) - (a.z ?? 0) ||
        a.position - b.position ||
        (a.created_at ?? 0) - (b.created_at ?? 0)
      )
      .forEach((note) => {
        const el = document.createElement("div");
        el.className = "note";
        el.dataset.noteId = note.id;
        const palette = NOTE_PALETTE[note.color.toUpperCase()];
        const baseColor = palette?.base ?? note.color;
        const textColor = palette?.text ?? "#1f2937";
        el.style.setProperty("--note-color", baseColor);
        el.style.setProperty("--note-text-color", textColor);
        el.style.left = note.x + "px";
        el.style.top = note.y + "px";
        el.style.zIndex = String(note.z ?? 0);

        if (highlightedNoteId === note.id) {
          el.classList.add("note--highlight");
          if (pendingScrollNoteId === note.id) {
            requestAnimationFrame(() => {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              pendingScrollNoteId = null;
            });
          }
        }

        if (!noteLinkCache.has(note.id) && !linkFetches.has(note.id)) {
          void ensureLinksForNote(note.id).then(() => render());
        }

        const eventLink = getEventLinkForNote(note.id);

        const textarea = document.createElement("textarea");
        textarea.value = note.text;
        textarea.addEventListener("input", () => {
          note.text = textarea.value;
          commitSnapshot("notes:text-change", false, true);
          saveSoon(async () => {
            try {
              const saved = await updateNote(
                householdId,
                note.id,
                { text: note.text },
                updateNoteFn,
              );
              Object.assign(note, saved);
              commitSnapshot("notes:text-change", true, true);
            } catch {}
          });
        });
        el.appendChild(textarea);

        if (note.deadline !== undefined && note.deadline !== null) {
          const deadlineWrapper = document.createElement("div");
          deadlineWrapper.className = "note__deadline-inline";
          const dueMs = Number(note.deadline);
          if (Number.isFinite(dueMs)) {
            const zone = note.deadline_tz ?? appTimezone ?? "UTC";
            const formatted = new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: zone,
            }).format(new Date(dueMs));
            const label = document.createElement("span");
            label.textContent = `Due ${formatted}`;
            deadlineWrapper.appendChild(label);
            const badge = createTimezoneBadge({
              eventTimezone: note.deadline_tz,
              appTimezone,
              tooltipId: `note-inline-deadline-${note.id}`,
            });
            if (!badge.hidden) deadlineWrapper.appendChild(badge);
            el.appendChild(deadlineWrapper);
          }
        }

        if (eventLink) {
          const linkRow = document.createElement("div");
          linkRow.className = "note__link-row";

          const chip = createButton({
            type: "button",
            variant: "ghost",
            size: "sm",
            className: "note__event-chip",
            label: "Linked event",
          });
          chip.disabled = true;

          const tooltip = document.createElement("div");
          tooltip.className = "note__event-tooltip";
          tooltip.hidden = true;

          const tooltipText = document.createElement("span");
          tooltipText.className = "note__event-tooltip-text";
          tooltip.appendChild(tooltipText);

          const badge = createTimezoneBadge({
            eventTimezone: null,
            appTimezone,
            tooltipId: `note-${note.id}-event-tz`,
            className: "note__event-tooltip-badge",
          });
          tooltip.appendChild(badge);

          const showTooltip = () => {
            if (tooltip.hidden) tooltip.hidden = false;
          };
          const hideTooltip = () => {
            if (!tooltip.hidden) tooltip.hidden = true;
          };
          chip.addEventListener("mouseenter", showTooltip);
          chip.addEventListener("mouseleave", hideTooltip);
          chip.addEventListener("focus", showTooltip);
          chip.addEventListener("blur", hideTooltip);

          linkRow.append(chip, tooltip);
          el.appendChild(linkRow);

          void (async () => {
            const event = await loadEventMetadata(eventLink.entity_id);
            if (!event || event.deleted_at) {
              chip.update({ label: "(deleted)" });
              chip.disabled = true;
              chip.classList.add("note__event-chip--deleted");
              tooltip.hidden = true;
              return;
            }
            chip.disabled = false;
            chip.update({ label: event.title?.trim() || "Untitled event" });
            chip.addEventListener("click", (evt) => {
              evt.preventDefault();
              navigateToCalendar(event.id);
            });
            tooltipText.textContent = formatEventStart(event);
            badge.update({ eventTimezone: event.tz, appTimezone });
          })();
        }

        const linkActions = document.createElement("div");
        linkActions.className = "note__link-actions";
        const linkButton = createButton({
          type: "button",
          variant: "ghost",
          size: "sm",
          label: "Link to event…",
        });
        linkButton.addEventListener("click", (event) => {
          event.preventDefault();
          linkButton.disabled = true;
          void openEventPicker(note).finally(() => {
            linkButton.disabled = false;
          });
        });
        linkActions.appendChild(linkButton);

        if (eventLink) {
          const unlinkButton = createButton({
            type: "button",
            variant: "ghost",
            size: "sm",
            label: "Unlink from event",
          });
          unlinkButton.addEventListener("click", (event) => {
            event.preventDefault();
            void unlinkEvent(note, eventLink, unlinkButton);
          });
          linkActions.appendChild(unlinkButton);
        }

        el.appendChild(linkActions);

        const deleteButton = createButton({
          type: "button",
          variant: "ghost",
          size: "sm",
          className: "note__control note__control--delete",
          ariaLabel: "Delete note",
          children: "\u00d7",
          onClick: async (event) => {
            event.preventDefault();
            note.deleted_at = Date.now();
            try {
              await deleteNoteFn(householdId, note.id);
              notesLocal = notesLocal.filter((n) => n.id !== note.id);
              commitSnapshot("notes:delete", true, true);
              render();
            } catch (err: any) {
              showError(err);
            }
          },
        });
        el.appendChild(deleteButton);

        const bringButton = createButton({
          type: "button",
          variant: "ghost",
          size: "sm",
          className: "note__control note__control--bring",
          ariaLabel: "Bring note to front",
          children: "\u2191",
          onClick: async (event) => {
            event.preventDefault();
            const maxZ = Math.max(0, ...notesLocal.filter((n) => !n.deleted_at).map((n) => n.z ?? 0));
            note.z = maxZ + 1;
            commitSnapshot("notes:bring", false, true);
            try {
              const saved = await updateNote(
                householdId,
                note.id,
                { z: note.z },
                updateNoteFn,
              );
              Object.assign(note, saved);
              commitSnapshot("notes:bring", true, true);
              render();
            } catch (err: any) {
              showError(err);
            }
          },
        });
        el.appendChild(bringButton);

        el.addEventListener("pointerdown", (e) => {
          if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = note.x;
          const origY = note.y;
          const maxZ = Math.max(0, ...notesLocal.filter((n) => !n.deleted_at).map((n) => n.z ?? 0));
          note.z = maxZ + 1;
          el.style.zIndex = String(note.z);
          commitSnapshot("notes:drag", false, true);
          saveSoon(async () => {
            try {
              const saved = await updateNote(
                householdId,
                note.id,
                { z: note.z },
                updateNoteFn,
              );
              Object.assign(note, saved);
              commitSnapshot("notes:drag", true, true);
            } catch {}
          });
          el.classList.add("dragging");
          el.setPointerCapture(e.pointerId);
          function onMove(ev: PointerEvent) {
            const maxX = canvas.clientWidth - el.offsetWidth;
            const maxY = canvas.clientHeight - el.offsetHeight;
            note.x = Math.max(0, Math.min(maxX, origX + (ev.clientX - startX)));
            note.y = Math.max(0, Math.min(maxY, origY + (ev.clientY - startY)));
            el.style.left = note.x + "px";
            el.style.top = note.y + "px";
          }
          async function onUp() {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.classList.remove("dragging");
            try {
              const saved = await updateNote(
                householdId,
                note.id,
                { x: note.x, y: note.y },
                updateNoteFn,
              );
              Object.assign(note, saved);
              commitSnapshot("notes:drag", true, true);
            } catch {}
          }
          el.addEventListener("pointermove", onMove);
          el.addEventListener("pointerup", onUp);
        });

        canvas.appendChild(el);
      });

    renderDeadlines(notesLocal);
  }

  const unsubscribe = subscribe(selectors.notes.snapshot, (snapshot) => {
    if (suppressNextRender) {
      suppressNextRender = false;
      return;
    }
    const items = snapshot?.items ?? [];
    notesLocal = cloneNotes(items);
    void hydrateLinksForNotes(notesLocal);
    render();
  });
  registerViewCleanup(container, unsubscribe);

  const stopRouteParams = subscribeRouteParams((params) => {
    const nextHighlight = params.noteId;
    if (highlightedNoteId === nextHighlight) return;
    highlightedNoteId = nextHighlight;
    pendingScrollNoteId = nextHighlight;
    render();
  });
  registerViewCleanup(container, stopRouteParams);

  const stopHousehold = on("household:changed", async ({ householdId: next }) => {
    householdId = next;
    noteLinkCache.clear();
    linkFetches.clear();
    eventCache.clear();
    cachedLinkableEvents = null;
    filterLinkedOnly = false;
    linkedCheckbox.checked = false;
    refreshQuickCaptureCategories();
    await reload("notes:household");
  });
  registerViewCleanup(container, stopHousehold);

  const stopCategorySubscription = subscribeActiveCategoryIds((ids) => {
    const signature = ids.join("|");
    if (signature === lastCategorySignature) return;
    activeCategoryIds = [...ids];
    lastCategorySignature = signature;
    refreshQuickCaptureCategories();
    void reload("notes:categories");
  });
  registerViewCleanup(container, stopCategorySubscription);

  const initialSnapshot: NotesSnapshot | null = selectors.notes.snapshot(getState());
  const snapshotCategories = initialSnapshot?.activeCategoryIds ?? [];
  const matchesActiveCategories =
    snapshotCategories.length === activeCategoryIds.length &&
    snapshotCategories.every((id, index) => id === activeCategoryIds[index]);
  if (initialSnapshot && matchesActiveCategories) {
    notesLocal = cloneNotes(initialSnapshot.items);
    await hydrateLinksForNotes(notesLocal);
    render();
  } else {
    await reload("notes:init");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const created = await insertNote(
        householdId,
        {
          text: textInput.value,
          color: colorInput.value,
          x: 10,
          y: 10,
          category_id: activeCategoryIds[0] ?? null,
        },
        createNoteFn,
      );
      notesLocal = mergeNotes(notesLocal, [created]);
      commitSnapshot("notes:create", true, true);
      render();
      form.reset();
      colorInput.value = DEFAULT_NOTE_COLOR;
    } catch (err: any) {
      showError(err);
    }
  });

  quickForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = quickTextInput.value.trim();
    if (!text) {
      quickTextInput.focus();
      return;
    }
    const categoryId = quickCategorySelect.value?.trim() || null;
    let deadline: number | null = null;
    let deadlineTz: string | null = null;
    const deadlineValue = quickDeadlineInput.value;
    if (deadlineValue) {
      const parsed = new Date(deadlineValue);
      if (Number.isFinite(parsed.getTime())) {
        deadline = parsed.getTime();
        deadlineTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      }
    }

    try {
      const created = await insertNote(
        householdId,
        {
          text,
          color: DEFAULT_NOTE_COLOR,
          x: 10,
          y: 10,
          category_id: categoryId,
          deadline,
          deadline_tz: deadlineTz,
        },
        createNoteFn,
      );
      notesLocal = mergeNotes(notesLocal, [created]);
      commitSnapshot("notes:quick-create", true, true);
      render();
      quickForm.reset();
      quickCaptureModal.setOpen(false);
      toast.show({ kind: "success", message: "Note captured." });
    } catch (err) {
      showError(err);
    }
  });

  const openQuickCapture = () => {
    refreshQuickCaptureCategories();
    quickTextInput.value = "";
    quickDeadlineInput.value = "";
    quickCaptureModal.setOpen(true);
  };

  const handleShortcut = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key !== "k" || !event.shiftKey) return;
    const platform = navigator?.platform ?? "";
    const isMac = platform.toLowerCase().includes("mac");
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (!modifier) return;
    event.preventDefault();
    openQuickCapture();
  };

  window.addEventListener("keydown", handleShortcut);
  registerViewCleanup(container, () => {
    window.removeEventListener("keydown", handleShortcut);
  });

  refreshQuickCaptureCategories();
}
