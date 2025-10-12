import { logUI } from "@lib/uiLog";
import { convertFileSrc } from "@lib/ipc/core";
import { canonicalizeAndVerify } from "@files/path";
import { revealLabel } from "../../ui/attachments";
import type { Pet } from "../../models";

export interface PetsPageCallbacks {
  onCreate?: (input: { name: string; type: string }) => Promise<Pet> | Pet;
  onOpenPet?: (pet: Pet) => void;
  onEditPet?: (pet: Pet, patch: { name: string; type: string }) => Promise<void> | void;
  onSearchChange?: (value: string) => void;
  onReorderPet?: (id: string, delta: number) => void;
  onChangePhoto?: (pet: Pet) => void;
  onRevealImage?: (pet: Pet) => void;
  onDeletePet?: (pet: Pet) => Promise<void> | void;
  onDeletePetHard?: (pet: Pet) => Promise<void> | void;
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
  patchPet(pet: Pet): void;
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
  media: HTMLDivElement;
  photo: HTMLImageElement;
  placeholder: HTMLImageElement;
  name: HTMLHeadingElement;
  typeText: HTMLParagraphElement;
  openBtn: HTMLButtonElement;
  editBtn: HTMLButtonElement;
  changePhotoBtn: HTMLButtonElement;
  revealBtn: HTMLButtonElement;
  moveUpBtn: HTMLButtonElement;
  moveDownBtn: HTMLButtonElement;
  nameInput: HTMLInputElement;
  typeInput: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  menu: HTMLDetailsElement;
  menuTrigger: HTMLElement;
  menuPanel: HTMLDivElement;
  softDeleteBtn: HTMLButtonElement;
  hardDeleteBtn: HTMLButtonElement;
  menuDivider: HTMLDivElement;
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

const CARD_DEFAULT_HEIGHT = 320;
const CARD_MIN_WIDTH = 260;
const GRID_DEFAULT_GAP = 24;
const BUFFER_ROWS = 8;

interface LayoutMetrics {
  columns: number;
  cardHeight: number;
  cardWidth: number;
  rowGap: number;
  columnGap: number;
}

const PLACEHOLDER_DOG = new URL("../../assets/pets/placeholders/dog.svg", import.meta.url).href;
const PLACEHOLDER_CAT = new URL("../../assets/pets/placeholders/cat.svg", import.meta.url).href;
const PLACEHOLDER_OTHER = new URL("../../assets/pets/placeholders/other.svg", import.meta.url).href;

const imageLoadTokens = new WeakMap<HTMLImageElement, string>();
const objectUrlCache = new WeakMap<HTMLImageElement, string>();
const IS_WEBKIT =
  typeof navigator !== "undefined" &&
  /AppleWebKit/i.test(navigator.userAgent) &&
  !/Chrome|Chromium|Edg/i.test(navigator.userAgent);
const IMAGE_LOAD_TIMEOUT_MS = IS_WEBKIT ? 4000 : 2000;

const isTauri =
  (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) ||
  (typeof (import.meta as any).env?.TAURI !== "undefined" && (import.meta as any).env?.TAURI != null);

function toDisplayName(pet: { name?: string | null }): string {
  const raw = pet.name ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "Unnamed pet";
}

function inferSpecies(pet: Pet): "dog" | "cat" | "other" {
  const raw = (pet.species ?? pet.type ?? "").toLowerCase();
  if (/dog|canine|retriever|poodle|husky/.test(raw)) return "dog";
  if (/cat|feline|kitten|siamese/.test(raw)) return "cat";
  return "other";
}

function placeholderFor(pet: Pet): string {
  const species = inferSpecies(pet);
  if (species === "dog") return PLACEHOLDER_DOG;
  if (species === "cat") return PLACEHOLDER_CAT;
  return PLACEHOLDER_OTHER;
}

function mimeFromExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

function revokeObjectUrl(image: HTMLImageElement) {
  const existing = objectUrlCache.get(image);
  if (existing) {
    try {
      URL.revokeObjectURL(existing);
    } catch {
      // ignore
    }
    objectUrlCache.delete(image);
  }
}

function normalise(value: string | null | undefined): string {
  return value ? value.normalize("NFC").toLowerCase() : "";
}

export function createPetsPage(
  container: HTMLElement,
  initialCallbacks: PetsPageCallbacks = {},
): PetsPageInstance {
  const idSuffix = Math.random().toString(36).slice(2, 8);
  const titleId = `pets-title-${idSuffix}`;
  const searchId = `pets-search-${idSuffix}`;
  const createAssistId = `pets-create-help-${idSuffix}`;
  const liveStatusId = `pets-status-${idSuffix}`;
  const listHelpId = `pets-list-help-${idSuffix}`;

  const root = document.createElement("section");
  root.className = "pets";
  root.setAttribute("role", "region");
  root.setAttribute("aria-labelledby", titleId);

  const liveStatus = document.createElement("p");
  liveStatus.className = "sr-only";
  liveStatus.id = liveStatusId;
  liveStatus.setAttribute("role", "status");
  liveStatus.setAttribute("aria-live", "polite");
  liveStatus.textContent = "Loading pets…";

  const listHelp = document.createElement("p");
  listHelp.className = "sr-only";
  listHelp.id = listHelpId;
  listHelp.textContent =
    "Use the arrow keys to move between pets. Press Enter to open details. Press Escape to return to the list.";

  const header = document.createElement("header");
  header.className = "pets__header";

  const title = document.createElement("h1");
  title.id = titleId;
  title.textContent = "Pets";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search pets…";
  search.className = "pets__search";
  search.id = searchId;

  const searchLabel = document.createElement("label");
  searchLabel.className = "sr-only";
  searchLabel.htmlFor = searchId;
  searchLabel.textContent = "Search pets";

  const createForm = document.createElement("form");
  createForm.className = "pets__create";
  createForm.autocomplete = "off";
  createForm.setAttribute("aria-describedby", createAssistId);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.required = true;
  nameInput.placeholder = "Name";
  nameInput.className = "pets__input";
  nameInput.name = "pet-name";
  nameInput.setAttribute("aria-label", "Pet name");

  const typeInput = document.createElement("input");
  typeInput.type = "text";
  typeInput.placeholder = "Type (optional)";
  typeInput.className = "pets__input";
  typeInput.name = "pet-type";
  typeInput.setAttribute("aria-label", "Pet type (optional)");

  const createButton = document.createElement("button");
  createButton.type = "submit";
  createButton.textContent = "Add pet";
  createButton.className = "pets__submit";

  createForm.append(nameInput, typeInput, createButton);

  const createAssist = document.createElement("p");
  createAssist.className = "sr-only";
  createAssist.id = createAssistId;
  createAssist.textContent = "Enter a pet name and optional type, then select Add pet.";
  createForm.append(createAssist);

  const controls = document.createElement("div");
  controls.className = "pets__controls";
  controls.append(searchLabel, search, createForm);

  header.append(title, controls);

  const body = document.createElement("div");
  body.className = "pets__body";

  const listViewport = document.createElement("div");
  listViewport.className = "pets__viewport";
  listViewport.tabIndex = 0;
  listViewport.setAttribute("role", "list");
  listViewport.setAttribute("aria-labelledby", titleId);
  listViewport.setAttribute("aria-describedby", `${liveStatusId} ${listHelpId}`);
  listViewport.setAttribute("aria-hidden", "false");

  const topSpacer = document.createElement("div");
  topSpacer.className = "pets__spacer pets__spacer--top";

  const itemsHost = document.createElement("div");
  itemsHost.className = "pets__grid";

  const bottomSpacer = document.createElement("div");
  bottomSpacer.className = "pets__spacer pets__spacer--bottom";

  listViewport.append(topSpacer, itemsHost, bottomSpacer);

  const emptyState = document.createElement("div");
  emptyState.className = "pets__empty";
  emptyState.dataset.state = "empty";
  emptyState.setAttribute("role", "status");
  emptyState.setAttribute("aria-live", "polite");
  emptyState.textContent = "You haven’t added any pets yet. Each will appear here with their photo and details.";
  emptyState.hidden = true;

  const detailHost = document.createElement("div");
  detailHost.className = "pets__detail";
  detailHost.hidden = true;
  detailHost.setAttribute("role", "region");
  detailHost.setAttribute("aria-label", "Pet details");
  detailHost.setAttribute("aria-hidden", "true");

  body.append(listViewport, emptyState, detailHost);
  root.append(header, body, liveStatus, listHelp);

  container.innerHTML = "";
  container.append(root);

  const rowCache = new WeakMap<HTMLDivElement, RowElements>();
  const visibleRows = new Map<number, RowState>();
  const rowPool: HTMLDivElement[] = [];
  const editing = new Map<string, EditingState>();
  let layout: LayoutMetrics = {
    columns: 1,
    cardHeight: CARD_DEFAULT_HEIGHT,
    cardWidth: CARD_MIN_WIDTH,
    rowGap: GRID_DEFAULT_GAP,
    columnGap: GRID_DEFAULT_GAP,
  };

  let totalPets = 0;
  let lastAnnouncement = liveStatus.textContent ?? "";
  let lastEmptyMessage = "";

  let callbacks = { ...initialCallbacks };
  let openMenu: HTMLDetailsElement | null = null;
  let detachMenuOutside: (() => void) | null = null;

  function closeActiveMenu(details?: HTMLDetailsElement | null) {
    const target = details ?? openMenu;
    if (target && target.open) {
      target.open = false;
    }
  }

  function ensureMenuOutsideListener() {
    if (detachMenuOutside || typeof document === "undefined") return;
    const handle = (event: PointerEvent) => {
      const current = openMenu;
      if (!current) return;
      const target = event.target as Node | null;
      if (target && current.contains(target)) {
        return;
      }
      current.open = false;
    };
    document.addEventListener("pointerdown", handle, true);
    detachMenuOutside = () => {
      document.removeEventListener("pointerdown", handle, true);
    };
  }

  function releaseMenuOutsideListener() {
    if (openMenu) return;
    detachMenuOutside?.();
    detachMenuOutside = null;
  }
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

  function setPets(next: Pet[]): void {
    totalPets = Array.isArray(next) ? next.length : 0;
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

  function patchPet(pet: Pet) {
    if (!pet) return;
    const index = models.findIndex((model) => model.pet.id === pet.id);
    if (index === -1) return;
    const existing = models[index];
    const nextView: FilteredPet = { ...existing, pet: { ...existing.pet, ...pet } };
    models[index] = nextView;
    const state = visibleRows.get(index);
    if (state) {
      state.view = nextView;
      updateRow(index, nextView);
    }
  }

  function showDetail(content: HTMLElement) {
    listViewport.hidden = true;
    emptyState.hidden = true;
    detailHost.hidden = false;
    detailHost.replaceChildren(content);
    listViewport.setAttribute("aria-hidden", "true");
    detailHost.setAttribute("aria-hidden", "false");
    liveStatus.textContent = "Showing pet details.";
    lastAnnouncement = liveStatus.textContent ?? "";
  }

  function showList() {
    detailHost.hidden = true;
    listViewport.hidden = false;
    listViewport.setAttribute("aria-hidden", "false");
    detailHost.setAttribute("aria-hidden", "true");
    refresh();
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
    if (openMenu) {
      openMenu.open = false;
      openMenu = null;
    }
    releaseMenuOutsideListener();
  }

  function ensureRowStructure(row: HTMLDivElement): RowElements {
    let cached = rowCache.get(row);
    if (cached) return cached;

    row.className = "pets__card";
    row.setAttribute("role", "region");

    const display = document.createElement("div");
    display.className = "pets__card-display";

    const media = document.createElement("div");
    media.className = "pets__media";
    media.dataset.state = "placeholder";

    const photo = document.createElement("img");
    photo.className = "pets__photo";
    photo.alt = "";
    photo.loading = "lazy";

    const placeholder = document.createElement("img");
    placeholder.className = "pets__placeholder";
    placeholder.alt = "";
    placeholder.src = PLACEHOLDER_OTHER;
    placeholder.setAttribute("aria-hidden", "false");

    media.append(photo, placeholder);

    const mediaActions = document.createElement("div");
    mediaActions.className = "pets__media-actions";

    const changePhotoBtn = document.createElement("button");
    changePhotoBtn.type = "button";
    changePhotoBtn.className = "pets__photo-action";
    changePhotoBtn.textContent = "Change photo";

    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "pets__photo-action pets__photo-action--reveal";
    const revealText = revealLabel();
    revealBtn.textContent = revealText;
    revealBtn.setAttribute("aria-label", revealText);

    mediaActions.append(changePhotoBtn, revealBtn);

    const body = document.createElement("div");
    body.className = "pets__card-body";

    const name = document.createElement("h3");
    name.className = "pets__name";

    const typeText = document.createElement("p");
    typeText.className = "pets__type";

    body.append(name, typeText);

    const actions = document.createElement("div");
    actions.className = "pets__actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open";
    openBtn.className = "pets__action pets__action--primary";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "pets__action";

    const orderGroup = document.createElement("div");
    orderGroup.className = "pets__order";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "pets__order-btn";
    moveUpBtn.setAttribute("aria-label", "Move up");
    moveUpBtn.textContent = "▲";

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "pets__order-btn";
    moveDownBtn.setAttribute("aria-label", "Move down");
    moveDownBtn.textContent = "▼";

    orderGroup.append(moveUpBtn, moveDownBtn);
    const menu = document.createElement("details");
    menu.className = "pets__menu";
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        if (openMenu && openMenu !== menu) {
          openMenu.open = false;
        }
        openMenu = menu;
        ensureMenuOutsideListener();
      } else if (openMenu === menu) {
        openMenu = null;
        releaseMenuOutsideListener();
      }
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) {
        event.preventDefault();
        menu.open = false;
      }
    });

    const menuTrigger = document.createElement("summary");
    menuTrigger.className = "pets__menu-trigger";
    menuTrigger.setAttribute("aria-label", "More actions");
    menuTrigger.setAttribute("aria-haspopup", "menu");
    menuTrigger.textContent = "⋯";
    menuTrigger.addEventListener("click", (event) => {
      if (menuTrigger.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
      }
    });

    const menuPanel = document.createElement("div");
    menuPanel.className = "pets__menu-panel";
    menuPanel.setAttribute("role", "menu");

    const softDeleteBtn = document.createElement("button");
    softDeleteBtn.type = "button";
    softDeleteBtn.className = "pets__menu-item";
    softDeleteBtn.textContent = "Delete";
    softDeleteBtn.setAttribute("role", "menuitem");

    const menuDivider = document.createElement("div");
    menuDivider.className = "pets__menu-divider";

    const hardDeleteBtn = document.createElement("button");
    hardDeleteBtn.type = "button";
    hardDeleteBtn.className = "pets__menu-item pets__menu-item--danger";
    hardDeleteBtn.textContent = "Delete Permanently";
    hardDeleteBtn.setAttribute("role", "menuitem");

    menuPanel.append(softDeleteBtn, menuDivider, hardDeleteBtn);
    menu.append(menuTrigger, menuPanel);

    actions.append(openBtn, editBtn, orderGroup, menu);

    display.append(media, mediaActions, body, actions);

    const editor = document.createElement("form");
    editor.className = "pets__card-editor";
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
      media,
      photo,
      placeholder,
      name,
      typeText,
      openBtn,
      editBtn,
      changePhotoBtn,
      revealBtn,
      moveUpBtn,
      moveDownBtn,
      nameInput,
      typeInput,
      saveBtn,
      cancelBtn,
      menu,
      menuTrigger,
      menuPanel,
      softDeleteBtn,
      hardDeleteBtn,
      menuDivider,
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
    const cached = rowCache.get(state.element);
    if (cached) {
      revokeObjectUrl(cached.photo);
      imageLoadTokens.delete(cached.photo);
      cached.photo.removeAttribute("src");
      cached.photo.dataset.photoKey = "";
      cached.media.dataset.state = "placeholder";
      cached.placeholder.setAttribute("aria-hidden", "false");
    }
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

  function measureLayout(): boolean {
    let rowGap = GRID_DEFAULT_GAP;
    let columnGap = GRID_DEFAULT_GAP;
    if (typeof window !== "undefined") {
      const styles = window.getComputedStyle(itemsHost);
      const parse = (value: string | null | undefined) => {
        if (!value) return NaN;
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : NaN;
      };
      const nextRowGap = parse(styles.rowGap ?? styles.gap ?? "");
      const nextColumnGap = parse(styles.columnGap ?? styles.gap ?? "");
      if (Number.isFinite(nextRowGap)) rowGap = nextRowGap;
      if (Number.isFinite(nextColumnGap)) columnGap = nextColumnGap;
    }

    let cardWidth = layout.cardWidth || CARD_MIN_WIDTH;
    let cardHeight = layout.cardHeight || CARD_DEFAULT_HEIGHT;
    const sample = itemsHost.querySelector<HTMLElement>(".pets__card");
    if (sample) {
      const rect = sample.getBoundingClientRect();
      if (rect.width > 0) cardWidth = rect.width;
      if (rect.height > 0) cardHeight = rect.height;
    }

    cardWidth = Math.max(CARD_MIN_WIDTH, cardWidth);
    cardHeight = Math.max(160, cardHeight);

    const viewportWidth = listViewport.clientWidth || 0;
    const columns = Math.max(
      1,
      Math.floor((viewportWidth + columnGap) / (cardWidth + columnGap)) || 1,
    );

    const next: LayoutMetrics = { columns, cardHeight, cardWidth, rowGap, columnGap };
    const changed =
      layout.columns !== next.columns ||
      Math.abs(layout.cardHeight - next.cardHeight) > 1 ||
      Math.abs(layout.cardWidth - next.cardWidth) > 1 ||
      Math.abs(layout.rowGap - next.rowGap) > 0.5 ||
      Math.abs(layout.columnGap - next.columnGap) > 0.5;

    layout = next;
    return changed;
  }

  function rowsToHeight(count: number): number {
    if (count <= 0) return 0;
    return count * layout.cardHeight + Math.max(0, count - 1) * layout.rowGap;
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
      media,
      photo,
      placeholder,
      name,
      typeText,
      openBtn,
      editBtn,
      changePhotoBtn,
      revealBtn,
      moveUpBtn,
      moveDownBtn,
      nameInput: editName,
      typeInput: editType,
      saveBtn,
      cancelBtn,
      menu,
      menuTrigger,
      menuPanel,
      softDeleteBtn,
      hardDeleteBtn,
      menuDivider,
    } = ensureRowStructure(row);

    rowEl.dataset.index = String(index);
    rowEl.dataset.id = view.pet.id;
    rowEl.tabIndex = -1;

    const displayName = toDisplayName(view.pet);
    rowEl.setAttribute("aria-label", `Pet card: ${displayName}`);

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

    const typeValue = (view.pet.type ?? "").trim();

    const editingState = editing.get(view.pet.id);
    const isSaving = Boolean(editingState?.saving);

    rowEl.dataset.state = editingState ? "editing" : "view";

    editName.disabled = isSaving;
    editType.disabled = isSaving;
    saveBtn.disabled = isSaving;
    cancelBtn.disabled = isSaving;
    changePhotoBtn.disabled = isSaving;
    openBtn.disabled = isSaving;
    editBtn.disabled = isSaving;

    const fallbackName = view.pet.name ?? "";
    editName.value = editingState?.name ?? fallbackName;
    editType.value = editingState?.type ?? (view.pet.type ?? "");

    if (editingState) {
      display.hidden = true;
      editor.hidden = false;
    } else {
      display.hidden = false;
      editor.hidden = true;
      if (fallbackName) {
        highlight(name, fallbackName, view.nameMatch ?? null);
      } else {
        name.textContent = displayName;
      }
      if (typeValue) {
        highlight(typeText, typeValue, view.typeMatch ?? null);
        typeText.dataset.empty = "false";
        typeText.classList.remove("pets__type--empty");
      } else {
        typeText.textContent = "Type not set";
        typeText.dataset.empty = "true";
        typeText.classList.add("pets__type--empty");
      }
    }

    const placeholderSrc = placeholderFor(view.pet);
    if (placeholder.src !== placeholderSrc) {
      placeholder.src = placeholderSrc;
    }
    photo.alt = displayName;

    const nextPhotoKey = view.pet.image_path ?? "";
    const previousKey = photo.dataset.photoKey ?? "";
    const hasPhoto = Boolean(nextPhotoKey) && Boolean(view.pet.household_id);
    revealBtn.disabled = !hasPhoto;
    revealBtn.setAttribute("aria-disabled", hasPhoto ? "false" : "true");

    const setPlaceholderVisibility = (visible: boolean) => {
      placeholder.setAttribute("aria-hidden", visible ? "false" : "true");
    };

    if (!hasPhoto) {
      revokeObjectUrl(photo);
      photo.dataset.photoKey = "";
      photo.removeAttribute("src");
      media.dataset.state = "placeholder";
      setPlaceholderVisibility(true);
      imageLoadTokens.delete(photo);
    } else if (previousKey !== nextPhotoKey) {
      photo.dataset.photoKey = nextPhotoKey;
      revokeObjectUrl(photo);
      photo.removeAttribute("src");
      media.dataset.state = isTauri ? "loading" : "placeholder";
      setPlaceholderVisibility(true);

      if (isTauri) {
        const loadToken = `${view.pet.id}-${Date.now()}-${Math.random()}`;
        imageLoadTokens.set(photo, loadToken);
        const relPath = `attachments/${view.pet.household_id}/pet_image/${nextPhotoKey}`;

        const applyLoaded = () => {
          if (imageLoadTokens.get(photo) !== loadToken) return;
          media.dataset.state = "ready";
          setPlaceholderVisibility(false);
          imageLoadTokens.delete(photo);
        };

        void (async () => {
          let loaded = false;
          try {
            const { realPath } = await canonicalizeAndVerify(relPath, "appData");
            const trySet = (src: string, opts?: { timeoutMs?: number }) =>
              new Promise<boolean>((resolve) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                let promoteTimer: ReturnType<typeof setInterval> | null = null;
                let promoteChecks = 0;
                const cleanup = () => {
                  photo.removeEventListener("load", onLoad);
                  photo.removeEventListener("error", onError);
                  if (timer != null) {
                    clearTimeout(timer);
                  }
                  if (promoteTimer != null) {
                    clearInterval(promoteTimer);
                  }
                };
                const settle = (value: boolean) => {
                  if (settled) return;
                  settled = true;
                  cleanup();
                  resolve(value);
                };
                const promoteIfDecoded = () => {
                  if (photo.complete && photo.naturalWidth > 0 && photo.naturalHeight > 0) {
                    settle(imageLoadTokens.get(photo) === loadToken);
                    return true;
                  }
                  return false;
                };
                const onLoad = () => {
                  settle(imageLoadTokens.get(photo) === loadToken);
                };
                const onError = () => {
                  settle(false);
                };
                const timeoutMs = opts?.timeoutMs ?? 0;
                if (timeoutMs > 0) {
                  timer = setTimeout(() => {
                    settle(false);
                  }, timeoutMs);
                }
                photo.addEventListener("load", onLoad, { once: true });
                photo.addEventListener("error", onError, { once: true });
                photo.removeAttribute("src");
                photo.src = src;

                if (promoteIfDecoded()) {
                  return;
                }

                promoteTimer = setInterval(() => {
                  if (promoteIfDecoded()) {
                    return;
                  }
                  if (++promoteChecks > 80) {
                    settle(false);
                  }
                }, 50);

                const maybeDecode = (photo as HTMLImageElement & {
                  decode?: () => Promise<void>;
                }).decode;
                if (typeof maybeDecode === "function") {
                  maybeDecode
                    .call(photo)
                    .then(() => {
                      if (imageLoadTokens.get(photo) !== loadToken) {
                        return;
                      }
                      promoteIfDecoded();
                    })
                    .catch(() => {
                      // ignore decode failure; onload/onerror handlers will handle fallback
                    });
                }
              });

            loaded = await trySet(convertFileSrc(realPath), { timeoutMs: IMAGE_LOAD_TIMEOUT_MS });
            if (!loaded) {
              try {
                const fs = await import("@tauri-apps/plugin-fs");
                const bytes = await fs.readFile(realPath);
                const byteLength =
                  bytes instanceof Uint8Array
                    ? bytes.byteLength
                    : Array.isArray(bytes)
                    ? bytes.length
                    : (bytes as ArrayBufferLike).byteLength ?? 0;

                if (!bytes || byteLength === 0) {
                  throw new Error("EMPTY_IMAGE_BYTES");
                }

                if (IS_WEBKIT) {
                  const buffer =
                    bytes instanceof Uint8Array
                      ? bytes
                      : Array.isArray(bytes)
                      ? Uint8Array.from(bytes)
                      : new Uint8Array(bytes as ArrayBufferLike);
                  let binary = "";
                  for (let i = 0; i < buffer.length; i += 1) {
                    binary += String.fromCharCode(buffer[i]);
                  }
                  const dataUrl = `data:${mimeFromExt(realPath)};base64,${btoa(binary)}`;
                  loaded = await trySet(dataUrl, { timeoutMs: IMAGE_LOAD_TIMEOUT_MS });
                } else {
                  const blob = new Blob([bytes], { type: mimeFromExt(realPath) });
                  const objectUrl = URL.createObjectURL(blob);
                  objectUrlCache.set(photo, objectUrl);
                  loaded = await trySet(objectUrl, { timeoutMs: IMAGE_LOAD_TIMEOUT_MS });
                  if (!loaded) {
                    revokeObjectUrl(photo);
                  }
                }
              } catch {
                // ignore fallback failure
              }
            }
          } catch {
            loaded = false;
          }

          if (imageLoadTokens.get(photo) !== loadToken) {
            if (!loaded) revokeObjectUrl(photo);
            return;
          }

          if (loaded) {
            applyLoaded();
          } else {
            media.dataset.state = "placeholder";
            setPlaceholderVisibility(true);
            imageLoadTokens.delete(photo);
          }
        })();
      }
    } else if (photo.currentSrc) {
      media.dataset.state = "ready";
      setPlaceholderVisibility(false);
    } else {
      media.dataset.state = "placeholder";
      setPlaceholderVisibility(true);
    }

    changePhotoBtn.onclick = () => {
      if (changePhotoBtn.disabled) return;
      callbacks.onChangePhoto?.(view.pet);
    };

    revealBtn.onclick = () => {
      if (revealBtn.disabled) return;
      callbacks.onRevealImage?.(view.pet);
    };

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

    const hasSoftDelete = typeof callbacks.onDeletePet === "function";
    const hasHardDelete = typeof callbacks.onDeletePetHard === "function";
    const menuEnabled = (hasSoftDelete || hasHardDelete) && !isSaving;

    if (!menuEnabled) {
      closeActiveMenu(menu);
    }

    menu.hidden = !(hasSoftDelete || hasHardDelete);
    menuTrigger.setAttribute("aria-disabled", menuEnabled ? "false" : "true");
    menuTrigger.tabIndex = menuEnabled ? 0 : -1;

    const softEnabled = hasSoftDelete && !isSaving;
    const hardEnabled = hasHardDelete && !isSaving;

    softDeleteBtn.hidden = !hasSoftDelete;
    softDeleteBtn.disabled = !softEnabled;
    hardDeleteBtn.hidden = !hasHardDelete;
    hardDeleteBtn.disabled = !hardEnabled;
    menuDivider.hidden = hardDeleteBtn.hidden || softDeleteBtn.hidden;

    softDeleteBtn.onclick = () => {
      if (!softEnabled) return;
      closeActiveMenu(menu);
      void Promise.resolve(callbacks.onDeletePet?.(view.pet));
    };

    hardDeleteBtn.onclick = () => {
      if (!hardEnabled) return;
      closeActiveMenu(menu);
      void Promise.resolve(callbacks.onDeletePetHard?.(view.pet));
    };

    if (!menuEnabled) {
      menuPanel.setAttribute("aria-hidden", "true");
    } else {
      menuPanel.removeAttribute("aria-hidden");
    }
  }

  function refresh(): void {
    const total = models.length;
    const listVisible = !listViewport.hidden;
    const query = search.value.trim();
    const hasQuery = query.length > 0;
    const hasAnyPets = totalPets > 0;
    let emptyMessage: string | null = null;

    if (listVisible && total === 0) {
      if (!hasAnyPets) {
        emptyMessage = "You haven’t added any pets yet. Each will appear here with their photo and details.";
        emptyState.dataset.state = "empty";
      } else if (hasQuery) {
        emptyMessage = `No pets match “${query}”. Clear the search to see everything.`;
        emptyState.dataset.state = "no-results";
      } else {
        emptyMessage = "No pets available.";
        emptyState.dataset.state = "empty";
      }
    }

    if (listVisible && emptyMessage) {
      emptyState.hidden = false;
      if (emptyMessage !== lastEmptyMessage) {
        emptyState.textContent = emptyMessage;
        lastEmptyMessage = emptyMessage;
      }
    } else {
      if (!emptyState.hidden) {
        emptyState.hidden = true;
      }
      if (listVisible) {
        lastEmptyMessage = "";
      }
    }

    const announcement = !listVisible
      ? lastAnnouncement
      : emptyMessage ??
          (hasQuery
            ? `${total} ${total === 1 ? "pet matches" : "pets match"} “${query}”.`
            : `${total} ${total === 1 ? "pet" : "pets"} available.`);
    if (announcement && announcement !== lastAnnouncement) {
      liveStatus.textContent = announcement;
      lastAnnouncement = announcement;
    }

    if (total === 0) {
      for (const index of Array.from(visibleRows.keys())) {
        recycleRow(index);
      }
      topSpacer.style.height = "0px";
      bottomSpacer.style.height = "0px";
      return;
    }

    const startTime =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    measureLayout();

    const viewportHeight = listViewport.clientHeight || 0;
    const scrollTop = listViewport.scrollTop;
    const rowHeight = Math.max(1, layout.cardHeight + layout.rowGap);
    const columns = Math.max(1, layout.columns);
    const visibleRowEstimate = Math.ceil(viewportHeight / rowHeight) + BUFFER_ROWS * 2;
    const totalRows = Math.max(1, Math.ceil(total / columns));
    const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - BUFFER_ROWS);
    const lastRow = Math.min(totalRows - 1, firstRow + visibleRowEstimate - 1);
    const firstIndex = Math.min(total - 1, firstRow * columns);
    const lastIndex = Math.min(total - 1, (lastRow + 1) * columns - 1);

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

    const before = rowsToHeight(firstRow);
    const afterRows = Math.max(0, totalRows - lastRow - 1);
    const after = rowsToHeight(afterRows);
    topSpacer.style.height = `${before}px`;
    bottomSpacer.style.height = `${after}px`;

    if (endMark) {
      performance.mark(endMark);
      performance.measure("pets.renderWindow", startMark!, endMark);
      performance.clearMarks(startMark!);
      performance.clearMarks(endMark);
    }

    if (measureLayout()) {
      scheduleRefresh();
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
    patchPet,
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
