// src/NotesView.ts
import { getHouseholdIdForCalls } from "./db/household";
import { showError } from "./ui/errors";
import {
  NotesList,
  useNotes,
  type Note,
  type NotesViewMode,
} from "@features/notes";
import {
  actions,
  selectors,
  subscribe,
  getState,
  type NotesSnapshot,
} from "./store/index";
import { emit, on } from "./store/events";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import {
  getActiveCategoryIds,
  getCategories,
  subscribeActiveCategoryIds,
  type StoreCategory,
} from "./store/categories";
import createButton from "@ui/Button";
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

const VIEW_MODE_STORAGE_KEY = "notes:view-mode";
const SORT_STORAGE_KEY = "notes:sort";
const COLOR_FILTER_STORAGE_KEY = "notes:color";

type NotesSortKey = "updated_at" | "created_at";
type NotesSortDirection = "asc" | "desc";

interface NotesSortOption {
  value: string;
  label: string;
  key: NotesSortKey;
  direction: NotesSortDirection;
}

const SORT_OPTIONS: NotesSortOption[] = [
  { value: "updated_desc", label: "Updated ↓", key: "updated_at", direction: "desc" },
  { value: "updated_asc", label: "Updated ↑", key: "updated_at", direction: "asc" },
  { value: "created_desc", label: "Created ↓", key: "created_at", direction: "desc" },
  { value: "created_asc", label: "Created ↑", key: "created_at", direction: "asc" },
];

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

  const readStoredViewMode = (): NotesViewMode => {
    try {
      const stored = window.localStorage?.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === "grid" || stored === "list") {
        return stored;
      }
    } catch {}
    return "grid";
  };

  const readStoredSort = (): NotesSortOption => {
    try {
      const stored = window.localStorage?.getItem(SORT_STORAGE_KEY);
      const match = SORT_OPTIONS.find((option) => option.value === stored);
      if (match) return match;
    } catch {}
    return SORT_OPTIONS[0];
  };

  const readStoredColor = (): string | null => {
    try {
      const stored = window.localStorage?.getItem(COLOR_FILTER_STORAGE_KEY);
      if (stored) return stored;
    } catch {}
    return null;
  };

  const section = document.createElement("section");
  section.className = "notes";

  const toolbar = document.createElement("header");
  toolbar.className = "notes__toolbar";

  const searchLabel = document.createElement("label");
  searchLabel.className = "sr-only";
  searchLabel.htmlFor = "notes-search";
  searchLabel.textContent = "Search notes";

  const searchInput = createInput({
    id: "notes-search",
    type: "search",
    placeholder: "Search notes…",
    ariaLabel: "Search notes",
    className: "notes__search",
  });

  const searchGroup = document.createElement("div");
  searchGroup.className = "notes__toolbar-group notes__toolbar-group--search";
  searchGroup.append(searchLabel, searchInput);

  const filtersGroup = document.createElement("div");
  filtersGroup.className = "notes__filters";

  const tagFilter = createSelect({
    id: "notes-filter-tag",
    ariaLabel: "Filter by tag",
    className: "notes__filter",
  });

  const colorFilter = createSelect({
    id: "notes-filter-color",
    ariaLabel: "Filter by colour",
    className: "notes__filter",
  });

  const sortSelect = createSelect({
    id: "notes-sort",
    ariaLabel: "Sort notes",
    className: "notes__sort",
  });

  filtersGroup.append(tagFilter, colorFilter, sortSelect);

  const viewToggle = document.createElement("div");
  viewToggle.className = "notes__view";

  const gridViewButton = createButton({
    label: "Grid",
    variant: "ghost",
    className: "notes__view-button",
    type: "button",
  });

  const listViewButton = createButton({
    label: "List",
    variant: "ghost",
    className: "notes__view-button",
    type: "button",
  });

  viewToggle.append(gridViewButton, listViewButton);

  const newNoteButton = createButton({
    label: "New note",
    variant: "primary",
    id: "note-new",
    type: "button",
  });

  toolbar.append(searchGroup, filtersGroup, viewToggle, newNoteButton);

  const pinnedContainer = document.createElement("section");
  pinnedContainer.className = "notes__pinned";
  pinnedContainer.setAttribute("aria-label", "Pinned notes");
  pinnedContainer.hidden = true;

  const viewMode: NotesViewMode = readStoredViewMode();
  const notesBoard = NotesList(viewMode);
  const canvas = notesBoard.element;

  const pagination = document.createElement("div");
  pagination.className = "notes__pagination";
  const loadMoreButton = createButton({
    label: "Load more",
    variant: "ghost",
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

  section.append(toolbar, pinnedContainer, canvas, pagination, deadlinesPanel);
  container.innerHTML = "";
  container.appendChild(section);

  const persistViewMode = (mode: NotesViewMode) => {
    try {
      window.localStorage?.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {}
  };

  const persistSort = (option: NotesSortOption) => {
    try {
      window.localStorage?.setItem(SORT_STORAGE_KEY, option.value);
    } catch {}
  };

  const persistColorFilter = (value: string | null) => {
    try {
      if (value) {
        window.localStorage?.setItem(COLOR_FILTER_STORAGE_KEY, value);
      } else {
        window.localStorage?.removeItem(COLOR_FILTER_STORAGE_KEY);
      }
    } catch {}
  };

  let searchTerm = "";
  let colorFilterValue = readStoredColor();
  let categoryFilterId: string | null = null;
  let sortState = readStoredSort();
  let viewModeState: NotesViewMode = viewMode;
  let notesLocal: Note[] = [];

  const updateViewButtons = () => {
    gridViewButton.update({ ariaPressed: viewModeState === "grid" });
    listViewButton.update({ ariaPressed: viewModeState === "list" });
  };

  const buildColorOptions = () => {
    const options = [{ value: "", label: "All colours" }];
    const seen = new Set<string>();
    const addColor = (hex: string | undefined) => {
      if (!hex) return;
      const normalised = hex.toUpperCase();
      if (seen.has(normalised)) return;
      seen.add(normalised);
      options.push({ value: normalised, label: `Color ${normalised}` });
    };
    Object.keys(NOTE_PALETTE).forEach(addColor);
    notesLocal.forEach((note) => addColor(note.color));
    return options;
  };

  const updateColorFilterOptions = () => {
    const options = buildColorOptions();
    const target = colorFilterValue ? colorFilterValue.toUpperCase() : "";
    colorFilter.update({ options, value: target });
  };

  const updateSortOptions = () => {
    sortSelect.update({
      options: SORT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      value: sortState.value,
    });
  };

  const updateTagFilterOptions = () => {
    const categories = getCategories();
    const options = [{ value: "", label: "All tags" }];
    categories.forEach((category) => {
      options.push({ value: category.id, label: category.name });
    });
    const currentIds = new Set(categories.map((category) => category.id));
    if (categoryFilterId && !currentIds.has(categoryFilterId)) {
      categoryFilterId = null;
    }
    tagFilter.update({ options, value: categoryFilterId ?? "" });
  };

  updateColorFilterOptions();
  updateSortOptions();
  updateTagFilterOptions();
  updateViewButtons();

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    render();
  });

  tagFilter.addEventListener("change", () => {
    categoryFilterId = tagFilter.value ? tagFilter.value : null;
    render();
  });

  colorFilter.addEventListener("change", () => {
    const value = colorFilter.value ? colorFilter.value.toUpperCase() : "";
    colorFilterValue = value ? value : null;
    persistColorFilter(colorFilterValue);
    render();
  });

  sortSelect.addEventListener("change", () => {
    const next = SORT_OPTIONS.find((option) => option.value === sortSelect.value);
    sortState = next ?? SORT_OPTIONS[0];
    persistSort(sortState);
    render();
  });

  const setViewMode = (mode: NotesViewMode) => {
    if (viewModeState === mode) return;
    viewModeState = mode;
    persistViewMode(mode);
    notesBoard.setViewMode(mode);
    updateViewButtons();
    render();
  };

  gridViewButton.addEventListener("click", (event) => {
    event.preventDefault();
    setViewMode("grid");
  });

  listViewButton.addEventListener("click", (event) => {
    event.preventDefault();
    setViewMode("list");
  });

  newNoteButton.addEventListener("click", (event) => {
    event.preventDefault();
    openQuickCapture();
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

  let editingNote: Note | null = null;

  const editTextarea = document.createElement("textarea");

  const editModal = createModal({
    open: false,
    onOpenChange: (open) => {
      if (!open) {
        editModal.setOpen(false);
        editingNote = null;
      }
    },
    titleId: "edit-note-title",
    initialFocus: () => editTextarea,
  });
  const editDialog = editModal.dialog;
  editDialog.classList.add("notes__edit-dialog");
  const editTitle = document.createElement("h2");
  editTitle.id = "edit-note-title";
  editTitle.textContent = "Edit note";

  const editForm = document.createElement("form");
  editForm.className = "notes__edit-form";

  const editTextLabel = document.createElement("label");
  editTextLabel.htmlFor = "edit-note-text";
  editTextLabel.textContent = "Note";

  editTextarea.id = "edit-note-text";
  editTextarea.required = true;
  editTextarea.rows = 6;
  editTextarea.className = "notes__edit-textarea";

  const editColorLabel = document.createElement("label");
  editColorLabel.htmlFor = "edit-note-color";
  editColorLabel.textContent = "Colour";

  const editColorInput = createInput({
    id: "edit-note-color",
    type: "color",
    ariaLabel: "Note colour",
    value: DEFAULT_NOTE_COLOR,
  });

  const editActions = document.createElement("div");
  editActions.className = "notes__edit-actions";

  const editCancel = createButton({
    type: "button",
    variant: "ghost",
    label: "Cancel",
  });
  editCancel.addEventListener("click", (event) => {
    event.preventDefault();
    editModal.setOpen(false);
  });

  const editSave = createButton({
    type: "submit",
    variant: "primary",
    label: "Save changes",
  });

  editActions.append(editCancel, editSave);

  editForm.append(
    editTextLabel,
    editTextarea,
    editColorLabel,
    editColorInput,
    editActions,
  );

  editDialog.append(editTitle, editForm);

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingNote) {
      editModal.setOpen(false);
      return;
    }
    const note = editingNote;
    const nextText = editTextarea.value.trim();
    if (!nextText) {
      editTextarea.focus();
      return;
    }
    const nextColor = editColorInput.value || DEFAULT_NOTE_COLOR;
    const previous = { text: note.text, color: note.color };
    note.text = nextText;
    note.color = nextColor;
    commitSnapshot("notes:edit", false, true);
    render();
    try {
      const saved = await updateNote(
        householdId,
        note.id,
        { text: nextText, color: nextColor },
        updateNoteFn,
      );
      Object.assign(note, saved);
      commitSnapshot("notes:edit", true, true);
      render();
      editModal.setOpen(false);
      toast.show({ kind: "success", message: "Note updated." });
    } catch (err) {
      note.text = previous.text;
      note.color = previous.color;
      commitSnapshot("notes:edit", true, true);
      render();
      showError(err);
    }
  });

  registerViewCleanup(container, () => {
    if (quickCaptureModal.isOpen()) quickCaptureModal.setOpen(false);
    if (quickCaptureModal.root.parentElement) {
      quickCaptureModal.root.remove();
    }
  });

  registerViewCleanup(container, () => {
    if (editModal.isOpen()) editModal.setOpen(false);
    if (editModal.root.parentElement) {
      editModal.root.remove();
    }
  });

  const useNotesFn = options.loadNotes ?? useNotes;
  const createNoteFn = options.createNote ?? notesRepo.create;
  const updateNoteFn = options.updateNote ?? notesRepo.update;
  const deleteNoteFn = options.deleteNote ?? notesRepo.delete;

  let householdId =
    options.householdId ??
    (await getHouseholdIdForCalls().catch(() => "default"));
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
  notesLocal = cloneNotes(selectors.notes.items(getState()));
  const appTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const filterVisibleNotes = (notes: Note[]): Note[] => {
    const base = notes.filter((note) => !note.deleted_at);
    if (!categoriesLoaded) {
      return base;
    }
    if (activeCategoryIds.length === 0) {
      return [];
    }
    const allowed = new Set(activeCategoryIds);
    return base.filter((note) => note.category_id && allowed.has(note.category_id));
  };

  const updateLoadMoreState = () => {
    const hasMore = Boolean(nextCursor);
    pagination.hidden = !hasMore;
    loadMoreButton.disabled = !hasMore || isLoading;
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
    updateTagFilterOptions();
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

  function openEditModal(note: Note): void {
    editingNote = note;
    editTextarea.value = note.text ?? "";
    editColorInput.value = note.color ?? DEFAULT_NOTE_COLOR;
    editModal.setOpen(true);
  }

  function isPinned(note: Note): boolean {
    return (note.position ?? 0) < 0;
  }

  function getSortValue(note: Note, key: NotesSortKey): number {
    if (key === "created_at") return note.created_at ?? 0;
    return note.updated_at ?? note.created_at ?? 0;
  }

  function formatRelative(timestamp: number | null | undefined): string {
    if (!timestamp) return "";
    const now = Date.now();
    let diffSeconds = Math.floor((now - timestamp) / 1000);
    const past = diffSeconds >= 0;
    diffSeconds = Math.abs(diffSeconds);
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 1) return past ? "just now" : "in moments";
    if (minutes < 60) return past ? `${minutes}m ago` : `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return past ? `${days}d ago` : `in ${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return past ? `${weeks}w ago` : `in ${weeks}w`;
    const months = Math.floor(days / 30);
    if (months < 12) return past ? `${months}mo ago` : `in ${months}mo`;
    const years = Math.floor(days / 365);
    return past ? `${years}y ago` : `in ${years}y`;
  }

  async function togglePinned(note: Note, desired: boolean): Promise<void> {
    const previousPosition = note.position ?? 0;
    const magnitude = Math.max(Math.abs(previousPosition), 1);
    const nextPosition = desired ? -magnitude : magnitude;
    note.position = nextPosition;
    commitSnapshot("notes:pin", false, true);
    render();
    try {
      const saved = await updateNote(
        householdId,
        note.id,
        { position: nextPosition },
        updateNoteFn,
      );
      Object.assign(note, saved);
      commitSnapshot("notes:pin", true, true);
      render();
    } catch (err) {
      note.position = previousPosition;
      commitSnapshot("notes:pin", true, true);
      render();
      throw err;
    }
  }

  async function deleteNote(note: Note): Promise<void> {
    const previousDeleted = note.deleted_at;
    note.deleted_at = Date.now();
    commitSnapshot("notes:delete", false, true);
    render();
    try {
      await deleteNoteFn(householdId, note.id);
      notesLocal = notesLocal.filter((entry) => entry.id !== note.id);
      commitSnapshot("notes:delete", true, true);
      render();
    } catch (err) {
      note.deleted_at = previousDeleted;
      commitSnapshot("notes:delete", true, true);
      render();
      throw err;
    }
  }

  function createDeadlineBadgeBlock(note: Note): HTMLElement | null {
    if (note.deadline === undefined || note.deadline === null) return null;
    const dueMs = Number(note.deadline);
    if (!Number.isFinite(dueMs)) return null;
    const zone = note.deadline_tz ?? appTimezone ?? "UTC";
    const formatted = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(dueMs));
    const wrapper = document.createElement("div");
    wrapper.className = "note__deadline";
    const label = document.createElement("span");
    label.textContent = `Due ${formatted}`;
    wrapper.appendChild(label);
    const badge = createTimezoneBadge({
      eventTimezone: note.deadline_tz,
      appTimezone,
      tooltipId: `note-deadline-${note.id}`,
    });
    if (!badge.hidden) wrapper.appendChild(badge);
    return wrapper;
  }

  function createNoteCard(note: Note): HTMLElement {
    const card = document.createElement("article");
    card.className = "note";
    if (viewModeState === "list") card.classList.add("note--list");
    if (isPinned(note)) card.classList.add("note--pinned");

    const normalizedColor = (note.color ?? DEFAULT_NOTE_COLOR).toUpperCase();
    const palette = NOTE_PALETTE[normalizedColor];
    const baseColor = palette?.base ?? note.color ?? DEFAULT_NOTE_COLOR;
    const textColor = palette?.text ?? "#1f2937";
    card.style.setProperty("--note-color", baseColor);
    card.style.setProperty("--note-text-color", textColor);

    const normalisedText = (note.text ?? "").replace(/\r\n/g, "\n");
    const lines = normalisedText.split("\n").map((line) => line.trim());
    const firstLineIndex = lines.findIndex((line) => line.length > 0);
    const titleText = firstLineIndex >= 0 ? lines[firstLineIndex] : "Untitled note";
    const bodyText = firstLineIndex >= 0 ? lines.slice(firstLineIndex + 1).join("\n").trim() : normalisedText.trim();

    const title = document.createElement("header");
    title.className = "note__title";
    title.textContent = titleText;
    card.appendChild(title);

    const body = document.createElement("div");
    body.className = "note__body";
    if (bodyText) {
      body.textContent = bodyText;
    } else {
      body.classList.add("note__body--empty");
      body.textContent = "No additional details";
    }
    card.appendChild(body);

    const deadlineBlock = createDeadlineBadgeBlock(note);
    if (deadlineBlock) card.appendChild(deadlineBlock);

    const meta = document.createElement("footer");
    meta.className = "note__meta";

    const referenceTs = getSortValue(note, sortState.key);
    const prefix = sortState.key === "created_at" ? "Created" : "Updated";
    const time = document.createElement("time");
    const iso = new Date(referenceTs || Date.now()).toISOString();
    time.dateTime = iso;
    const relative = formatRelative(referenceTs);
    time.textContent = relative ? `${prefix} ${relative}` : prefix;
    meta.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "note__actions";

    const pinButton = createButton({
      type: "button",
      variant: "ghost",
      size: "sm",
      className: "note__action",
    });
    const refreshPinButton = () => {
      const pinned = isPinned(note);
      pinButton.update({
        ariaLabel: pinned ? "Unpin note" : "Pin note",
        children: pinned ? "📌" : "📍",
      });
    };
    refreshPinButton();
    pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      pinButton.disabled = true;
      void togglePinned(note, !isPinned(note))
        .catch((err) => {
          showError(err);
        })
        .finally(() => {
          if (!pinButton.isConnected) return;
          pinButton.disabled = false;
          refreshPinButton();
        });
    });
    actions.appendChild(pinButton);

    const editButton = createButton({
      type: "button",
      variant: "ghost",
      size: "sm",
      className: "note__action",
      ariaLabel: "Edit note",
      children: "✏️",
    });
    editButton.addEventListener("click", (event) => {
      event.preventDefault();
      openEditModal(note);
    });
    actions.appendChild(editButton);

    const deleteButton = createButton({
      type: "button",
      variant: "ghost",
      size: "sm",
      className: "note__action note__action--delete",
      ariaLabel: "Delete note",
      children: "🗑️",
    });
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      deleteButton.disabled = true;
      void deleteNote(note)
        .catch((err) => {
          showError(err);
        })
        .finally(() => {
          if (deleteButton.isConnected) {
            deleteButton.disabled = false;
          }
        });
    });
    actions.appendChild(deleteButton);

    meta.appendChild(actions);
    card.appendChild(meta);

    return card;
  }

  function render() {
    notesBoard.clear();
    pinnedContainer.innerHTML = "";
    updateColorFilterOptions();

    const visible = filterVisibleNotes(notesLocal).filter((note) => {
      if (categoryFilterId && note.category_id !== categoryFilterId) return false;
      if (colorFilterValue && note.color.toUpperCase() !== colorFilterValue) return false;
      if (searchTerm) {
        const text = note.text?.toLowerCase() ?? "";
        if (!text.includes(searchTerm)) return false;
      }
      return true;
    });

    const sorted = visible.sort((a, b) => {
      const aValue = getSortValue(a, sortState.key);
      const bValue = getSortValue(b, sortState.key);
      const direction = sortState.direction === "asc" ? 1 : -1;
      if (aValue === bValue) {
        return (a.created_at ?? 0) - (b.created_at ?? 0);
      }
      return (aValue - bValue) * direction;
    });

    const pinned = sorted.filter((note) => isPinned(note));
    const regular = sorted.filter((note) => !isPinned(note));

    if (pinned.length > 0) {
      pinnedContainer.hidden = false;
      pinned.forEach((note) => {
        pinnedContainer.appendChild(createNoteCard(note));
      });
    } else {
      pinnedContainer.hidden = true;
    }

    if (regular.length === 0 && pinned.length === 0) {
      const empty = document.createElement("div");
      empty.className = "notes__empty";
      empty.textContent = "Create your first note to get started.";
      notesBoard.element.appendChild(empty);
    } else {
      regular.forEach((note) => {
        notesBoard.element.appendChild(createNoteCard(note));
      });
    }

    renderDeadlines(notesLocal);
  }

  const unsubscribe = subscribe(selectors.notes.snapshot, (snapshot) => {
    if (suppressNextRender) {
      suppressNextRender = false;
      return;
    }
    const items = snapshot?.items ?? [];
    notesLocal = cloneNotes(items);
    render();
  });
  registerViewCleanup(container, unsubscribe);

  const stopHousehold = on("household:changed", async ({ householdId: next }) => {
    householdId = next;
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
    snapshotCategories.every((id, index) => id === (activeCategoryIds[index] ?? null));
  if (initialSnapshot && matchesActiveCategories) {
    notesLocal = cloneNotes(initialSnapshot.items);
    render();
  } else {
    await reload("notes:init");
  }

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
          x: 0,
          y: 0,
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

  function openQuickCapture(): void {
    refreshQuickCaptureCategories();
    quickTextInput.value = "";
    quickDeadlineInput.value = "";
    quickCaptureModal.setOpen(true);
  }

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
