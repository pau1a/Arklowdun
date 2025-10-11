import { logUI } from "@lib/uiLog";
import type { Pet } from "../../models";

export interface PetsPageCallbacks {
  onCreate?: (input: { name: string; type: string }) => Promise<Pet> | Pet;
  onOpenPet?: (pet: Pet) => void;
  onEditPet?: (pet: Pet, patch: { name: string; type: string }) => Promise<void> | void;
  onSearchChange?: (value: string) => void;
  onReorderPet?: (id: string, delta: number) => void;
}

export interface FilteredPet {
  pet: Pet;
  nameMatch?: [number, number] | null;
  typeMatch?: [number, number] | null;
}

export interface PetsPageInstance {
  readonly element: HTMLElement;
  readonly listViewport: HTMLDivElement;
  setCallbacks(callbacks: PetsPageCallbacks): void;
  setPets(pets: Pet[]): void;
  setFilter(models: FilteredPet[]): void;
  focusCreate(): void;
  focusSearch(): void;
  clearSearch(): void;
  getSearchValue(): string;
  submitCreateForm(): boolean;
  focusRow(id: string): void;
  showDetail(content: HTMLElement): void;
  showList(): void;
  getScrollOffset(): number;
  setScrollOffset(offset: number): void;
  destroy(): void;
}

interface RowElements {
  row: HTMLDivElement;
  display: HTMLDivElement;
  editor: HTMLFormElement;
  name: HTMLSpanElement;
  typePill: HTMLSpanElement;
  openBtn: HTMLButtonElement;
  editBtn: HTMLButtonElement;
  moveUpBtn: HTMLButtonElement;
  moveDownBtn: HTMLButtonElement;
  nameInput: HTMLInputElement;
  typeInput: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
}

interface RowState {
  element: HTMLDivElement;
  view: FilteredPet;
}

interface EditingState {
  name: string;
  type: string;
  saving: boolean;
}

const ROW_HEIGHT = 56;
const BUFFER_ROWS = 8;

function normalise(value: string | null | undefined): string {
  return value ? value.normalize("NFC").toLowerCase() : "";
}

export function createPetsPage(
  container: HTMLElement,
  initialCallbacks: PetsPageCallbacks = {},
): PetsPageInstance {
  const root = document.createElement("section");
  root.className = "pets";

  const header = document.createElement("header");
  header.className = "pets__header";

  const title = document.createElement("h1");
  title.textContent = "Pets";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search pets…";
  search.className = "pets__search";
  search.setAttribute("aria-label", "Search pets");

  const createForm = document.createElement("form");
  createForm.className = "pets__create";
  createForm.autocomplete = "off";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.required = true;
  nameInput.placeholder = "Name";
  nameInput.className = "pets__input";
  nameInput.name = "pet-name";

  const typeInput = document.createElement("input");
  typeInput.type = "text";
  typeInput.placeholder = "Type";
  typeInput.className = "pets__input";
  typeInput.name = "pet-type";

  const createButton = document.createElement("button");
  createButton.type = "submit";
  createButton.textContent = "Add";
  createButton.className = "pets__submit";

  createForm.append(nameInput, typeInput, createButton);

  const controls = document.createElement("div");
  controls.className = "pets__controls";
  controls.append(search, createForm);

  header.append(title, controls);

  const body = document.createElement("div");
  body.className = "pets__body";

  const listViewport = document.createElement("div");
  listViewport.className = "pets__viewport";
  listViewport.tabIndex = 0;
  listViewport.setAttribute("role", "list");

  const topSpacer = document.createElement("div");
  topSpacer.className = "pets__spacer pets__spacer--top";

  const itemsHost = document.createElement("div");
  itemsHost.className = "pets__items";

  const bottomSpacer = document.createElement("div");
  bottomSpacer.className = "pets__spacer pets__spacer--bottom";

  listViewport.append(topSpacer, itemsHost, bottomSpacer);

  const emptyState = document.createElement("div");
  emptyState.className = "pets__empty";
  emptyState.textContent = "No pets yet";
  emptyState.hidden = true;

  const detailHost = document.createElement("div");
  detailHost.className = "pets__detail";
  detailHost.hidden = true;

  body.append(listViewport, emptyState, detailHost);
  root.append(header, body);

  container.innerHTML = "";
  container.append(root);

  const rowCache = new WeakMap<HTMLDivElement, RowElements>();
  const visibleRows = new Map<number, RowState>();
  const rowPool: HTMLDivElement[] = [];
  const editing = new Map<string, EditingState>();

  let callbacks = { ...initialCallbacks };
  let models: FilteredPet[] = [];
  let scrollRaf = 0;
  let pendingScroll = false;
  let perfEnabled = false;
  let pendingFocusId: string | null = null;
  let lastTimingSample = 0;

  if (typeof window !== "undefined") {
    const hash = window.location?.hash ?? "";
    perfEnabled = /[?&]perf=1\b/.test(hash) || /[?&]pets-perf=1\b/.test(hash);
  }

  const measureObserver =
    typeof PerformanceObserver !== "undefined"
      ? new PerformanceObserver((list) => {
          if (!perfEnabled) return;
          for (const entry of list.getEntries()) {
            if (entry.name !== "pets.renderWindow") continue;
            // eslint-disable-next-line no-console
            console.info("[pets] renderWindow", entry.duration.toFixed(2), "ms", entry);
          }
        })
      : null;
  measureObserver?.observe({ entryTypes: ["measure"] });

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          scheduleRefresh();
        })
      : null;
  if (resizeObserver) {
    resizeObserver.observe(listViewport);
  } else if (typeof window !== "undefined") {
    window.addEventListener("resize", scheduleRefresh);
  }

  function setCallbacks(next: PetsPageCallbacks) {
    callbacks = { ...callbacks, ...next };
  }

  function setPets(_next: Pet[]): void {
    // The virtualised list relies on the filtered models array.
    // Retain the method for API compatibility but no internal state is required.
  }

  function setFilter(next: FilteredPet[]): void {
    models = next;
    refresh();
  }

  function focusCreate() {
    nameInput.focus();
  }

  function focusSearch() {
    search.focus();
    search.select();
  }

  function clearSearch() {
    if (!search.value) return;
    search.value = "";
    callbacks.onSearchChange?.("");
  }

  function getSearchValue(): string {
    return search.value;
  }

  function submitCreateForm(): boolean {
    const isValid = createForm.checkValidity();
    if (!isValid) {
      createForm.reportValidity();
      return false;
    }
    createForm.requestSubmit();
    return true;
  }

  function focusRow(id: string) {
    pendingFocusId = id;
    scheduleRefresh();
  }

  function showDetail(content: HTMLElement) {
    listViewport.hidden = true;
    emptyState.hidden = true;
    detailHost.hidden = false;
    detailHost.replaceChildren(content);
  }

  function showList() {
    detailHost.hidden = true;
    listViewport.hidden = false;
    if (models.length === 0) {
      emptyState.hidden = false;
    } else {
      emptyState.hidden = true;
    }
  }

  function getScrollOffset(): number {
    return listViewport.scrollTop;
  }

  function setScrollOffset(offset: number) {
    listViewport.scrollTop = offset;
  }

  function destroy() {
    measureObserver?.disconnect();
    resizeObserver?.disconnect();
    listViewport.removeEventListener("scroll", scheduleRefresh);
    listViewport.removeEventListener("keydown", handleOrderKey, true);
    if (!resizeObserver && typeof window !== "undefined") {
      window.removeEventListener("resize", scheduleRefresh);
    }
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    visibleRows.clear();
    rowPool.length = 0;
    editing.clear();
  }

  function ensureRowStructure(row: HTMLDivElement): RowElements {
    let cached = rowCache.get(row);
    if (cached) return cached;

    row.className = "pets__row";
    row.setAttribute("role", "listitem");

    const display = document.createElement("div");
    display.className = "pets__row-display";

    const text = document.createElement("div");
    text.className = "pets__text";

    const name = document.createElement("span");
    name.className = "pets__name";

    const typePill = document.createElement("span");
    typePill.className = "pets__type-pill";

    text.append(name, typePill);

    const actions = document.createElement("div");
    actions.className = "pets__actions";

    const orderGroup = document.createElement("div");
    orderGroup.className = "pets__order";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "pets__order-btn";
    moveUpBtn.textContent = "▲";
    moveUpBtn.setAttribute("aria-label", "Move up");

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "pets__order-btn";
    moveDownBtn.textContent = "▼";
    moveDownBtn.setAttribute("aria-label", "Move down");

    orderGroup.append(moveUpBtn, moveDownBtn);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open";
    openBtn.className = "pets__action";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "pets__action";

    actions.append(orderGroup, openBtn, editBtn);
    display.append(text, actions);

    const editor = document.createElement("form");
    editor.className = "pets__row-editor";
    editor.hidden = true;

    const editorFields = document.createElement("div");
    editorFields.className = "pets__editor-fields";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.className = "pets__input";
    nameInput.placeholder = "Name";

    const typeInput = document.createElement("input");
    typeInput.type = "text";
    typeInput.className = "pets__input";
    typeInput.placeholder = "Type";

    editorFields.append(nameInput, typeInput);

    const editorActions = document.createElement("div");
    editorActions.className = "pets__editor-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save";
    saveBtn.className = "pets__action";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "pets__action";

    editorActions.append(saveBtn, cancelBtn);
    editor.append(editorFields, editorActions);

    row.append(display, editor);

    cached = {
      row,
      display,
      editor,
      name,
      typePill,
      openBtn,
      editBtn,
      moveUpBtn,
      moveDownBtn,
      nameInput,
      typeInput,
      saveBtn,
      cancelBtn,
    };
    rowCache.set(row, cached);
    return cached;
  }

  function acquireRow(): HTMLDivElement {
    const next = rowPool.pop();
    if (next) return next;
    const row = document.createElement("div");
    ensureRowStructure(row);
    return row;
  }

  function recycleRow(index: number) {
    const state = visibleRows.get(index);
    if (!state) return;
    visibleRows.delete(index);
    state.element.remove();
    rowPool.push(state.element);
  }

  function highlight(element: HTMLElement, text: string, match: [number, number] | null | undefined) {
    element.textContent = "";
    if (!text) return;
    if (!match || match[0] < 0 || match[1] <= match[0]) {
      element.textContent = text;
      return;
    }
    const start = match[0];
    const end = Math.min(match[1], text.length);
    if (start > 0) {
      element.append(document.createTextNode(text.slice(0, start)));
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    element.append(mark);
    if (end < text.length) {
      element.append(document.createTextNode(text.slice(end)));
    }
  }

  function updateRow(index: number, view: FilteredPet): void {
    let rowState = visibleRows.get(index);
    let row = rowState?.element;
    if (!rowState || !row) {
      row = acquireRow();
      itemsHost.appendChild(row);
      rowState = { element: row, view };
      visibleRows.set(index, rowState);
    } else {
      rowState.view = view;
    }

    const {
      row: rowEl,
      display,
      editor,
      name,
      typePill,
      openBtn,
      editBtn,
      moveUpBtn,
      moveDownBtn,
      nameInput: editName,
      typeInput: editType,
      saveBtn,
      cancelBtn,
    } = ensureRowStructure(row);

    rowEl.dataset.index = String(index);
    rowEl.dataset.id = view.pet.id;
    rowEl.tabIndex = -1;

    const shouldFocus = pendingFocusId === view.pet.id;
    if (shouldFocus) {
      pendingFocusId = null;
      rowEl.tabIndex = 0;
      requestAnimationFrame(() => {
        if (!rowEl.isConnected) return;
        try {
          rowEl.focus();
        } catch {
          /* ignore focus errors */
        }
        rowEl.tabIndex = -1;
      });
    }

    const typeValue = view.pet.type || "";

    const editingState = editing.get(view.pet.id);
    if (editingState?.saving) {
      editName.disabled = true;
      editType.disabled = true;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
    } else {
      editName.disabled = false;
      editType.disabled = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }

    if (editingState) {
      display.hidden = true;
      editor.hidden = false;
      editName.value = editingState.name;
      editType.value = editingState.type;
    } else {
      display.hidden = false;
      editor.hidden = true;
      highlight(name, view.pet.name, view.nameMatch ?? null);
      if (typeValue) {
        highlight(typePill, typeValue, view.typeMatch ?? null);
        typePill.hidden = false;
      } else {
        typePill.textContent = "";
        typePill.hidden = true;
      }
    }

    openBtn.onclick = () => callbacks.onOpenPet?.(view.pet);
    editBtn.onclick = () => {
      if (editing.has(view.pet.id)) return;
      editing.set(view.pet.id, { name: view.pet.name, type: view.pet.type, saving: false });
      updateRow(index, view);
      editName.focus();
    };

    const canReorder = typeof callbacks.onReorderPet === "function";
    moveUpBtn.disabled =
      !canReorder || index === 0 || Boolean(editingState?.saving) || Boolean(editingState);
    moveDownBtn.disabled =
      !canReorder || index >= models.length - 1 || Boolean(editingState?.saving) || Boolean(editingState);
    moveUpBtn.onclick = () => callbacks.onReorderPet?.(view.pet.id, -1);
    moveDownBtn.onclick = () => callbacks.onReorderPet?.(view.pet.id, 1);

    editName.oninput = () => {
      const state = editing.get(view.pet.id);
      if (!state) return;
      state.name = editName.value;
    };

    editType.oninput = () => {
      const state = editing.get(view.pet.id);
      if (!state) return;
      state.type = editType.value;
    };

    editor.onsubmit = (event) => {
      event.preventDefault();
      const state = editing.get(view.pet.id);
      if (!state || state.saving) return;
      const nextName = editName.value.trim();
      if (!nextName) {
        editName.focus();
        return;
      }
      const nextType = editType.value.trim();
      state.saving = true;
      editing.set(view.pet.id, state);
      updateRow(index, view);
      void Promise.resolve(callbacks.onEditPet?.(view.pet, { name: nextName, type: nextType })).finally(() => {
        if (!editing.has(view.pet.id)) return;
        editing.delete(view.pet.id);
        updateRow(index, view);
      });
    };

    cancelBtn.onclick = () => {
      if (!editing.has(view.pet.id)) return;
      editing.delete(view.pet.id);
      updateRow(index, view);
    };
  }

  function refresh(): void {
    const total = models.length;
    const startTime =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    emptyState.hidden = total > 0;
    const viewportHeight = listViewport.clientHeight || 0;
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    const scrollTop = listViewport.scrollTop;
    const firstIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const lastIndex = Math.min(total - 1, firstIndex + visibleCount - 1);

    const startMark = typeof performance !== "undefined" && performance.mark ? "pets.renderWindow:start" : null;
    const endMark = typeof performance !== "undefined" && performance.mark ? "pets.renderWindow:end" : null;
    if (startMark) performance.mark(startMark);

    // Remove rows outside the window
    for (const index of Array.from(visibleRows.keys())) {
      if (index < firstIndex || index > lastIndex) {
        recycleRow(index);
      }
    }

    let rendered = 0;

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const view = models[index];
      if (!view) continue;
      updateRow(index, view);
      rendered += 1;
    }

    const before = firstIndex * ROW_HEIGHT;
    const after = Math.max(0, (total - lastIndex - 1) * ROW_HEIGHT);
    topSpacer.style.height = `${before}px`;
    bottomSpacer.style.height = `${after}px`;

    if (endMark) {
      performance.mark(endMark);
      performance.measure("pets.renderWindow", startMark!, endMark);
      performance.clearMarks(startMark!);
      performance.clearMarks(endMark);
    }

    if (rendered > 0) {
      const fromIdx = firstIndex;
      const toIdx = Math.min(lastIndex, total - 1);
      const nowTs =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      const duration = Math.max(0, Math.round(nowTs - startTime));
      if (perfEnabled) {
        // eslint-disable-next-line no-console
        console.debug("perf.pets.window_render", { rendered, fromIdx, toIdx, duration });
      }
      if (nowTs - lastTimingSample >= 200) {
        lastTimingSample = nowTs;
        logUI("INFO", "perf.pets.timing", {
          name: "list.window_render",
          duration_ms: duration,
          ok: true,
          rows_rendered: rendered,
          from_idx: fromIdx,
          to_idx: toIdx,
        });
      }
    }
  }

  function scheduleRefresh() {
    if (pendingScroll) return;
    pendingScroll = true;
    scrollRaf = requestAnimationFrame(() => {
      pendingScroll = false;
      refresh();
    });
  }

  function handleOrderKey(event: KeyboardEvent) {
    if (!event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const target = event.target;
    if (!target || !(target instanceof HTMLElement)) return;
    const row = target.closest<HTMLDivElement>(".pets__row");
    if (!row) return;
    const isEditableTarget =
      Boolean(target.closest("input, textarea, select, [contenteditable='true']")) ||
      Boolean((target as HTMLElement).isContentEditable);
    if (isEditableTarget) return;
    const id = row.dataset.id;
    if (!id) return;
    if (editing.has(id)) return;
    event.preventDefault();
    event.stopPropagation();
    callbacks.onReorderPet?.(id, event.key === "ArrowUp" ? -1 : 1);
  }

  listViewport.addEventListener("scroll", scheduleRefresh, { passive: true });
  listViewport.addEventListener("keydown", handleOrderKey, true);

  search.addEventListener("input", () => {
    callbacks.onSearchChange?.(search.value);
  });

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const type = typeInput.value.trim();
    createButton.disabled = true;
    createButton.textContent = "Adding…";
    void Promise.resolve(callbacks.onCreate?.({ name, type })).then((created) => {
      if (!created) return;
      nameInput.value = "";
      typeInput.value = "";
      nameInput.focus();
    }).finally(() => {
      createButton.disabled = false;
      createButton.textContent = "Add";
    });
  });

  return {
    element: root,
    listViewport,
    setCallbacks,
    setPets,
    setFilter,
    focusCreate,
    focusSearch,
    clearSearch,
    getSearchValue,
    submitCreateForm,
    focusRow,
    showDetail,
    showList,
    getScrollOffset,
    setScrollOffset,
    destroy,
  };
}

export function createFilterModels(pets: Pet[], query: string): FilteredPet[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return pets.map((pet) => ({ pet }));
  }
  const normalisedQuery = normalise(trimmed);
  return pets
    .map<FilteredPet | null>((pet) => {
      const name = pet.name ?? "";
      const type = pet.type ?? "";
      const breed = (pet as Pet & { breed?: string | null }).breed ?? "";
      const nameNorm = normalise(name);
      const typeNorm = normalise(type);
      const breedNorm = normalise(breed);

      const nameIdx = nameNorm.indexOf(normalisedQuery);
      const typeIdx = typeNorm.indexOf(normalisedQuery);
      const breedIdx = breedNorm.indexOf(normalisedQuery);

      if (nameIdx === -1 && typeIdx === -1 && breedIdx === -1) {
        return null;
      }

      return {
        pet,
        nameMatch: nameIdx >= 0 ? [nameIdx, nameIdx + normalisedQuery.length] : null,
        typeMatch: typeIdx >= 0 ? [typeIdx, typeIdx + normalisedQuery.length] : null,
      };
    })
    .filter((value): value is FilteredPet => value !== null);
}
