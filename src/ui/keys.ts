export type OverlayKind = "modal" | "palette";

interface OverlayEntry {
  id: symbol;
  kind: OverlayKind;
  close: () => void;
}

export type PaneDirection = "next" | "prev";

export interface KeyboardBindingsOptions {
  openCommandPalette: () => void;
  cyclePane?: (direction: PaneDirection) => void;
}

const overlayStack: OverlayEntry[] = [];
let keyHandler: ((event: KeyboardEvent) => void) | null = null;
let currentOptions: KeyboardBindingsOptions | null = null;
let paletteActive = false;

const RESERVED = new Set(["[", "]"]);

function updatePaletteState() {
  paletteActive = overlayStack.some((entry) => entry.kind === "palette");
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iP(hone|ad|od)/.test(navigator.platform);
}

function isPrimaryModifier(event: KeyboardEvent): boolean {
  if (isMacPlatform()) {
    return event.metaKey;
  }
  return event.ctrlKey;
}

function shouldSkipShortcut(event: KeyboardEvent): boolean {
  if (paletteActive) return false;
  const target = event.target;
  if (!target || !(target instanceof Element)) return false;
  const element = target as HTMLElement;
  if (typeof element.closest === "function" && element.closest("input, textarea, select")) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  const role = element.getAttribute("role");
  return role === "textbox" || role === "combobox";
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;

  if (event.key === "Escape") {
    const closed = closeTopOverlay();
    if (closed) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (shouldSkipShortcut(event)) return;

  const key = event.key.length === 1 ? event.key : event.key.toLowerCase();

  if (isPrimaryModifier(event) && key.toLowerCase() === "k" && currentOptions) {
    if (event.altKey || event.shiftKey) return;
    event.preventDefault();
    currentOptions.openCommandPalette();
    return;
  }

  if ((key === "[" || key === "]") && currentOptions) {
    if (currentOptions.cyclePane) {
      event.preventDefault();
      event.stopPropagation();
      currentOptions.cyclePane(key === "]" ? "next" : "prev");
    }
    return;
  }
}

export function initKeyboardMap(options: KeyboardBindingsOptions) {
  currentOptions = options;
  if (keyHandler || typeof document === "undefined") return;
  keyHandler = (event: KeyboardEvent) => handleKeydown(event);
  document.addEventListener("keydown", keyHandler, true);
}

function closeTopOverlay(): boolean {
  const entry = overlayStack.pop();
  if (!entry) return false;
  updatePaletteState();
  try {
    entry.close();
  } catch (error) {
    console.error("overlay close failed", error);
  }
  return true;
}

export function registerOverlay(kind: OverlayKind, close: () => void): () => void {
  const entry: OverlayEntry = { id: Symbol("overlay"), kind, close };
  overlayStack.push(entry);
  updatePaletteState();
  return () => {
    const index = overlayStack.findIndex((item) => item.id === entry.id);
    if (index >= 0) overlayStack.splice(index, 1);
    updatePaletteState();
  };
}

export function isShortcutReserved(key: string): boolean {
  return RESERVED.has(key);
}

export function formatShortcut(key: string): string {
  const normalized = key.toUpperCase();
  return isMacPlatform() ? `⌘${normalized}` : `Ctrl+${normalized}`;
}

export function __resetKeyboardMapForTests() {
  if (keyHandler && typeof document !== "undefined") {
    document.removeEventListener("keydown", keyHandler, true);
  }
  keyHandler = null;
  currentOptions = null;
  overlayStack.length = 0;
  updatePaletteState();
}
