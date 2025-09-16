import { search } from "../services/searchRepo";
import type { SearchResult } from "../bindings/SearchResult";
import { showError } from "./errors";
import { highlight } from "../utils/highlight";

interface PaletteItem {
  kind: string;
  title: string;
  subtitle?: string;
  icon: string;
  action: () => void;
}

export function initCommandPalette() {
  const modalRoot = document.getElementById("modal-root");
  const live = document.querySelector<HTMLDivElement>("#search-live");
  const trigger = document.getElementById("sidebar-search");
  if (!modalRoot || !live) return;

  let palette: HTMLElement | null = null;
  let input: HTMLInputElement;
  let list: HTMLUListElement;
  let activeIndex = -1;
  let reqId = 0;
  let lastFocused: HTMLElement | null = null;
  const MINLEN = Number(import.meta.env.VITE_SEARCH_MINLEN ?? "2");
  let t: number | undefined;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  function announce(text: string) {
    if (live) live.textContent = text;
  }

  function build() {
    palette = document.createElement("div");
    palette.id = "command-palette";
    palette.className = "command-palette";
    palette.hidden = true;
    palette.setAttribute("role", "dialog");
    palette.setAttribute("aria-modal", "true");
    palette.setAttribute("aria-labelledby", "cp-title");
    palette.innerHTML = `
      <div class="command-palette__panel">
        <h2 id="cp-title" class="sr-only">Command palette</h2>
        <input id="cp-input" type="search" placeholder="Search…" role="combobox" aria-expanded="false" aria-controls="cp-list" autocomplete="off" />
        <div class="command-palette__results"><ul id="cp-list" role="listbox"></ul></div>
        <p id="cp-help" class="sr-only">Type to search. Use Arrow keys to navigate, Enter to select, Escape to close.</p>
      </div>`;
    palette.addEventListener("click", (e) => {
      if (e.target === palette) close();
    });
    if (modalRoot) modalRoot.appendChild(palette);
    input = palette.querySelector<HTMLInputElement>("#cp-input")!;
    list = palette.querySelector<HTMLUListElement>("#cp-list")!;
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-describedby", "cp-help");
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyDown);
    palette.addEventListener("keydown", onGlobalKey);
  }

  function open() {
    if (!palette) build();
    palette!.hidden = false;
    document.documentElement.style.overflow = "hidden";
    lastFocused = document.activeElement as HTMLElement;
    input.value = "";
    list.innerHTML = "";
    activeIndex = -1;
    reqId++;
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
    input.focus();
  }

  function close() {
    if (!palette) return;
    palette.hidden = true;
    document.documentElement.style.overflow = "";
    reqId++;
    activeIndex = -1;
    input.value = "";
    input.removeAttribute("aria-busy");
    input.setAttribute("aria-expanded", "false");
    if (lastFocused) lastFocused.focus();
  }

  function options(): HTMLLIElement[] {
    return Array.from(list.querySelectorAll<HTMLLIElement>('li[role="option"]'));
  }

  function onGlobalKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else if (e.key === "Tab") {
      const opts = options();
      if (!opts.length) {
        e.preventDefault();
        return;
      }
      const current = document.activeElement as HTMLElement;
      const first = opts[0];
      const last = opts[opts.length - 1];
      if (e.shiftKey) {
        e.preventDefault();
        if (current === input) {
          last.focus();
        } else {
          const idx = opts.indexOf(current as HTMLLIElement);
          if (idx > 0) opts[idx - 1].focus();
          else input.focus();
        }
      } else {
        e.preventDefault();
        if (current === input) {
          first.focus();
        } else {
          const idx = opts.indexOf(current as HTMLLIElement);
          if (idx >= 0 && idx < opts.length - 1) opts[idx + 1].focus();
          else input.focus();
        }
      }
    }
  }

  function onInput() {
    const q = input.value.trim();
    list.innerHTML = "";
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    if (!q || q.length < MINLEN) {
      input.setAttribute("aria-expanded", "false");
      announce("");
      return;
    }
    debouncedRun(q);
  }

  function debouncedRun(q: string) {
    if (t) clearTimeout(t);
    t = window.setTimeout(() => run(q), 200);
  }

  async function run(q: string) {
    const my = ++reqId;
    showStatus("Searching…", "loading");
    try {
      const results = await search(q, 50, 0);
      if (my !== reqId) return;
      if (results.length === 0) {
        showStatus("No results", "empty");
        announce(`No results for ${q}`);
        return;
      }
      const items: PaletteItem[] = results.map(mapResult);
      render(items, q);
      announce(`${results.length} results for ${q}`);
    } catch (err) {
      if (my !== reqId) return;
      showStatus("Error", "error");
      announce("Search error");
      showError(err);
    }
  }

  function showStatus(msg: string, kind: "loading" | "empty" | "error") {
    input.setAttribute("aria-expanded", "true");
    if (kind === "loading") input.setAttribute("aria-busy", "true");
    else input.removeAttribute("aria-busy");
    list.innerHTML = `<li role="presentation" class="cmd-${kind}">${msg}</li>`;
  }

  function render(items: PaletteItem[], q: string) {
    list.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("tabindex", "-1");
      li.setAttribute("aria-selected", "false");
      const title = highlight(item.title, q);
      const subtitle = highlight(item.subtitle ?? "", q);
      li.innerHTML = `<i class="${item.icon}"></i><span>${title}</span>${item.subtitle ? `<span>${subtitle}</span>` : ""}`;
      li.addEventListener("click", () => {
        item.action();
        close();
      });
      list.appendChild(li);
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    const opts = options();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!opts.length) return;
      e.preventDefault();
      activeIndex = e.key === "ArrowDown" ? Math.min(activeIndex + 1, opts.length - 1) : Math.max(activeIndex - 1, 0);
      opts.forEach((el, i) => {
        const active = i === activeIndex;
        el.setAttribute("aria-selected", active ? "true" : "false");
        if (active) {
          const id = el.id || `cp-option-${i}`;
          el.id = id;
          input.setAttribute("aria-activedescendant", id);
          el.scrollIntoView({ block: "nearest", behavior: prefersReduced ? "auto" : "smooth" });
        }
      });
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && opts[activeIndex]) {
        e.preventDefault();
        opts[activeIndex].click();
      }
    }
  }

  function mapResult(it: SearchResult): PaletteItem {
    if (it.kind === "File") {
      const date = new Date(it.updated_at).toLocaleString();
      return {
        kind: it.kind,
        title: it.filename,
        subtitle: date,
        icon: "fa-regular fa-file",
        action: () => {
          location.hash = "#files";
        },
      };
    }
    if (it.kind === "Event") {
      const date = new Intl.DateTimeFormat(undefined, { timeZone: it.tz }).format(new Date(it.start_at_utc));
      return {
        kind: it.kind,
        title: it.title,
        subtitle: date,
        icon: "fa-regular fa-calendar",
        action: () => {
          location.hash = "#calendar";
        },
      };
    }
    if (it.kind === "Note") {
      const date = new Date(it.updated_at).toLocaleString();
      return {
        kind: it.kind,
        title: it.snippet,
        subtitle: date,
        icon: "fa-regular fa-note-sticky",
        action: () => {
          location.hash = "#notes";
        },
      };
    }
    if (it.kind === "Vehicle") {
      const date = new Date(it.updated_at).toLocaleString();
      const title = [it.make, it.model].filter(Boolean).join(" ");
      const reg = it.reg?.trim() ? ` · ${it.reg}` : "";
      const nick = it.nickname?.trim() ? ` — ${it.nickname}` : "";
      return {
        kind: it.kind,
        title: `${title}${reg}${nick}`,
        subtitle: date,
        icon: "fa-solid fa-car",
        action: () => {
          location.hash = "#vehicles";
        },
      };
    }
    if (it.kind === "Pet") {
      const date = new Date(it.updated_at).toLocaleString();
      const species = it.species ? ` · ${it.species}` : "";
      return {
        kind: it.kind,
        title: `${it.name}${species}`,
        subtitle: date,
        icon: "fa-solid fa-paw",
        action: () => {
          location.hash = "#pets";
        },
      };
    }
    return {
      kind: "Unknown",
      title: "Unknown",
      icon: "fa-solid fa-question",
      action: () => {},
    };
  }

  if (trigger) {
    const label = isMac ? "Search (⌘K)" : "Search (Ctrl+K)";
    trigger.setAttribute("aria-label", label);
    trigger.setAttribute("title", label);
    trigger.addEventListener("click", () => open());
  }

  if (!(window as any).__cpBound) {
    (window as any).__cpBound = true;
    document.addEventListener("keydown", (e) => {
      const inEditor = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]');
      if (inEditor) return;
      if ((isMac && e.metaKey && e.key.toLowerCase() === "k") || (!isMac && e.ctrlKey && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        open();
      }
    });
    window.addEventListener("hashchange", () => close());
  }
}
