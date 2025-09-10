// Simple tabbed UI scaffold for Arklowdun
// Bundle Font Awesome locally (no remote kit, no CORS, works offline)
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./debug";
import "./theme.scss";
import "./styles.scss";
import { showError } from "./ui/errors";
import { CalendarView } from "./CalendarView";
import { FilesView } from "./FilesView";
import { ShoppingListView } from "./ShoppingListView";
import { BillsView } from "./BillsView";
import { InsuranceView } from "./InsuranceView";
import { VehiclesView } from "./VehiclesView";
import { PetsView } from "./PetsView";
import { FamilyView } from "./FamilyView";
import { PropertyView } from "./PropertyView";
import { SettingsView } from "./SettingsView";
import { InventoryView } from "./InventoryView";
import { BudgetView } from "./BudgetView";
import { NotesView } from "./NotesView";
import { DashboardView } from "./DashboardView";
import { ManageView } from "./ManageView";
import { ImportModal } from "./ui/ImportModal";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { defaultHouseholdId } from "./db/household";
import { log } from "./utils/logger";
import { search } from "./services/searchRepo";
import type { SearchResult } from "./bindings/SearchResult";
const appWindow = getCurrentWindow();

type View =
  | "dashboard"
  | "primary"
  | "secondary"
  | "tasks"
  | "calendar"
  | "files"
  | "shopping"
  | "bills"
  | "insurance"
  | "property"
  | "vehicles"
  | "pets"
  | "family"
  | "inventory"
  | "budget"
  | "notes"
  | "settings"
  | "manage";

const viewEl = () => document.querySelector<HTMLElement>("#view");
const linkDashboard = () =>
  document.querySelector<HTMLAnchorElement>("#nav-dashboard");
const linkPrimary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-primary");
const linkSecondary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-secondary");
const linkTasks = () =>
  document.querySelector<HTMLAnchorElement>("#nav-tasks");
const linkCalendar = () =>
  document.querySelector<HTMLAnchorElement>("#nav-calendar");
const linkFiles = () =>
  document.querySelector<HTMLAnchorElement>("#nav-files");
const linkShopping = () =>
  document.querySelector<HTMLAnchorElement>("#nav-shopping");
const linkBills = () =>
  document.querySelector<HTMLAnchorElement>("#nav-bills");
const linkInsurance = () =>
  document.querySelector<HTMLAnchorElement>("#nav-insurance");
const linkProperty = () =>
  document.querySelector<HTMLAnchorElement>("#nav-property");
const linkVehicles = () =>
  document.querySelector<HTMLAnchorElement>("#nav-vehicles");
const linkPets = () => document.querySelector<HTMLAnchorElement>("#nav-pets");
const linkFamily = () =>
  document.querySelector<HTMLAnchorElement>("#nav-family");
const linkInventory = () =>
  document.querySelector<HTMLAnchorElement>("#nav-inventory");
const linkBudget = () =>
  document.querySelector<HTMLAnchorElement>("#nav-budget");
const linkNotes = () =>
  document.querySelector<HTMLAnchorElement>("#nav-notes");
const linkManage = () =>
  document.querySelector<HTMLAnchorElement>("#nav-manage");

/**
 * Determine the initial view based on the current location fragment.
 * Falls back to "dashboard" when the hash is missing or unrecognized.
 */
function routeFromHashOrDefault(): View {
  const fragment = window.location.hash.replace(/^#/, "");
  const valid: View[] = [
    "dashboard",
    "primary",
    "secondary",
    "tasks",
    "calendar",
    "files",
    "shopping",
    "bills",
    "insurance",
    "property",
    "vehicles",
    "pets",
    "family",
    "inventory",
    "budget",
    "notes",
    "settings",
    "manage",
  ];
  if (valid.includes(fragment as View)) return fragment as View;

  location.replace("#dashboard");
  return "dashboard";
}


// --- HEIGHT-ONLY floor: ensure full sidebar is visible ---
// Width is not constrained here.
function findScrollableContent(root: HTMLElement): HTMLElement {
  let best = root;
  let bestSH = root.scrollHeight;
  const stack: HTMLElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY)) {
      const sh = el.scrollHeight;
      if (sh > bestSH) {
        best = el;
        bestSH = sh;
      }
    }
    stack.push(...(Array.from(el.children) as HTMLElement[]));
  }
  return best;
}

function requiredLogicalFloor(): { w: number; h: number } {
  const MIN_WIDTH = 800;
  const MIN_CONTENT_HEIGHT = 480;
  const MIN_APP_HEIGHT = 600;

  const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
  const headerEl = document.querySelector<HTMLElement>("#titlebar");
  const footerEl = document.querySelector<HTMLElement>("footer");

  const headerH = headerEl?.getBoundingClientRect().height ?? 0;
  const footerH = footerEl?.getBoundingClientRect().height ?? 0;

  const contentRoot = sidebarEl ? findScrollableContent(sidebarEl) : null;
  const intrinsic = contentRoot ? contentRoot.scrollHeight : 0;

  const neededH = Math.max(
    MIN_APP_HEIGHT,
    headerH + footerH + Math.max(MIN_CONTENT_HEIGHT, intrinsic)
  );
  return { w: MIN_WIDTH, h: neededH };
}

let raf: number | null = null;
let lastMin = { w: 0, h: 0 };
async function enforceMinNow(growOnly = true) {
  const { w, h } = requiredLogicalFloor();
  const nextW = lastMin.w ? Math.max(w, lastMin.w) : w;
  const nextH = lastMin.h && growOnly ? Math.max(h, lastMin.h) : h;
  try {
    await appWindow.setMinSize(new LogicalSize(nextW, nextH));
    lastMin = { w: nextW, h: nextH };

    const current = await appWindow.innerSize();
    const sf = await appWindow.scaleFactor();
    const curW = current.width / sf;
    const curH = current.height / sf;
    if (curW < nextW || curH < nextH) {
      await appWindow.setSize(
        new LogicalSize(Math.max(curW, nextW), Math.max(curH, nextH))
      );
    }
  } catch (e) {
    log.warn("enforceMinNow failed", e);
  }
}

function calibrateMinHeight(durationMs = 1000) {
  const start = performance.now();
  const tick = async () => {
    const before = lastMin.h;
    await enforceMinNow(true);
    const after = lastMin.h;
    if (after > before) {
      if (performance.now() - start < durationMs) requestAnimationFrame(tick);
      return;
    }
    if (performance.now() - start < durationMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupDynamicMinSize() {
  const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebarEl) return;
  const mo = new MutationObserver(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => enforceMinNow(true));
  });
  mo.observe(sidebarEl, { childList: true, subtree: true, characterData: true });
  calibrateMinHeight(1000);
}

function addImportButtonToSettings(container: HTMLElement) {
  const about =
    container.querySelector<HTMLElement>(
      'section[aria-labelledby="settings-about"]'
    ) ?? container;
  if (about.querySelector('[data-testid="open-import-btn"]')) return;

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-start";
  row.style.gap = "8px";
  row.style.marginTop = "12px";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.testid = "open-import-btn";
  btn.textContent = "Import legacy data…";
  btn.onclick = () => {
    const host = document.createElement("div");
    host.className = "modal-overlay";
    document.body.appendChild(host);
    ImportModal(host);
  };

  row.appendChild(btn);
  about.appendChild(row);
}

function setActive(tab: View) {
  const tabs: Record<View, HTMLAnchorElement | null> = {
    dashboard: linkDashboard(),
    manage: linkManage(),
    primary: linkPrimary(),
    secondary: linkSecondary(),
    tasks: linkTasks(),
    calendar: linkCalendar(),
    files: linkFiles(),
    shopping: linkShopping(),
    bills: linkBills(),
    insurance: linkInsurance(),
    property: linkProperty(),
    vehicles: linkVehicles(),
    pets: linkPets(),
    family: linkFamily(),
    inventory: linkInventory(),
    budget: linkBudget(),
    notes: linkNotes(),
    settings: null,
  };
  (Object.keys(tabs) as View[]).forEach((name) => {
    const el = tabs[name];
    const active = name === tab;
    el?.classList.toggle("active", active);
    if (active) el?.setAttribute("aria-current", "page");
    else el?.removeAttribute("aria-current");
    const icon = el?.querySelector<HTMLElement>(".nav__icon");
    if (icon && !icon.dataset.fixed) {
      icon.classList.toggle("fa-solid", active);
      icon.classList.toggle("fa-regular", !active);
    }
  });
  const manageEl = linkManage();
  if (manageEl) {
    const isCurrent = tab === "manage";
    manageEl.classList.toggle("is-current", isCurrent);
    if (isCurrent) manageEl.setAttribute("aria-current", "page");
    else manageEl.removeAttribute("aria-current");
  }
}

function renderBlank(title: string) {
  const el = viewEl();
  if (!el) return;
  el.innerHTML = `<section><h2>${title}</h2></section>`;
}

function navigate(to: View) {
  setActive(to);
  const el = viewEl();
  if (!el) return;

  if (to === "dashboard") {
    DashboardView(el);
    return;
  }
  if (to === "calendar") {
    CalendarView(el);
    return;
  }
  if (to === "files") {
    FilesView(el);
    return;
  }
  if (to === "shopping") {
    ShoppingListView(el);
    return;
  }
  if (to === "bills") {
    BillsView(el);
    return;
  }
  if (to === "insurance") {
    InsuranceView(el);
    return;
  }
  if (to === "property") {
    PropertyView(el);
    return;
  }
  if (to === "vehicles") {
    VehiclesView(el);
    return;
  }
  if (to === "pets") {
    PetsView(el);
    return;
  }
  if (to === "family") {
    FamilyView(el);
    return;
  }
  if (to === "inventory") {
    InventoryView(el);
    return;
  }
  if (to === "budget") {
    BudgetView(el);
    return;
  }
  if (to === "notes") {
    NotesView(el);
    return;
  }
  if (to === "settings") {
    SettingsView(el);
    const settingsContainer = el.querySelector<HTMLElement>(".settings");
    if (settingsContainer) addImportButtonToSettings(settingsContainer);
    return;
  }
  if (to === "manage") {
    ManageView(el);
    return;
  }
  const title = to.charAt(0).toUpperCase() + to.slice(1);
  renderBlank(title);
}

window.addEventListener("DOMContentLoaded", () => {
  log.debug("app booted");
  defaultHouseholdId().catch((e) => console.error("DB init failed:", e));


    const input = document.querySelector<HTMLInputElement>('#omnibox')!;
    const panel = document.querySelector<HTMLElement>('#omnibox-results')!;
    const list = panel.querySelector<HTMLUListElement>('ul')!;
    list.id = 'omnibox-list';
    const live = document.getElementById('search-live')!;

    let timer: number | undefined;
    let offset = 0;
    let current = '';
    let reqId = 0;
    let activeIndex = -1;

    let announceTimer: number | undefined;
    function announce(text: string) {
      if (announceTimer) clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => { live.textContent = text; }, 150);
    }

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'omnibox-list');
    list.setAttribute('role', 'listbox');

    function positionResults() {
      const r = input.getBoundingClientRect();
      const GAP = 8;
      const top = Math.round(r.bottom + 6);
      const left = Math.round(r.right + GAP);
      const rightPadding = 16;
      const maxWidth = Math.min(520, window.innerWidth - left - rightPadding);
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
      panel.style.width = `${Math.max(260, maxWidth)}px`;
    }

    function hideResults() {
      list.innerHTML = '';
      panel.querySelector('.omnibox__empty')?.remove();
      panel.querySelector('.omnibox__load-more')?.remove();
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
    }

    async function run(q: string, append = false) {
      const myId = ++reqId;
      const start = performance.now();
      try {
        const items = await search(q, 100, offset);
        const took = Math.round(performance.now() - start);
        log.debug('search:run', { q, offset, count: items.length, took_ms: took });
        if (myId !== reqId) return;
        const MINLEN = Number(import.meta.env.VITE_SEARCH_MINLEN ?? '2');
        if (import.meta.env.DEV && q.length >= MINLEN && items.length === 0) {
          const householdId = await defaultHouseholdId();
          console.debug("[search] no results", { q, householdId });
        }
        render(items, append, q);
      } catch (err) {
        if (myId !== reqId) return;
        showError(err);
      }
    }

    function render(items: SearchResult[], append: boolean, q: string) {
      const start = performance.now();
      const oldLoad = panel.querySelector('.omnibox__load-more');
      if (oldLoad) oldLoad.remove();
      const oldEmpty = panel.querySelector('.omnibox__empty');
      if (oldEmpty) oldEmpty.remove();

      if (!append) {
        list.innerHTML = '';
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
      }

      if (!append && items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'omnibox__empty';
        empty.textContent = `No results found for ${q}`;
        panel.appendChild(empty);
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        positionResults();
        announce(`No results for ${q}`);
        return;
      }

      const startIndex = list.children.length;
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        li.id = `omnix-option-${startIndex + i}`;
        li.setAttribute('aria-selected', 'false');
        if (it.kind === 'File') {
          const date = new Date(it.updated_at).toLocaleString();
          li.innerHTML = `<i class="fa-regular fa-file"></i><span>${it.filename}</span><span>${date}</span>`;
          li.addEventListener('click', () => {
            location.hash = '#files';
            hideResults();
            setTimeout(() => input.blur(), 0);
          });
        } else if (it.kind === 'Event') {
          const date = new Intl.DateTimeFormat(undefined, { timeZone: it.tz }).format(new Date(it.start_at_utc));
          li.innerHTML = `<i class="fa-regular fa-calendar"></i><span>${it.title}</span><span>${date}</span>`;
          li.addEventListener('click', () => {
            location.hash = '#calendar';
            hideResults();
            setTimeout(() => input.blur(), 0);
          });
        } else if (it.kind === 'Note') {
          const date = new Date(it.updated_at).toLocaleString();
          li.innerHTML = `<i class="fa-regular fa-note-sticky" style="color:${it.color}"></i><span>${it.snippet}</span><span>${date}</span>`;
          li.addEventListener('click', () => {
            location.hash = '#notes';
            hideResults();
            setTimeout(() => input.blur(), 0);
          });
        } else if (it.kind === 'Vehicle') {
          const date = new Date(it.updated_at).toLocaleString();
          const title = [it.make, it.model].filter(Boolean).join(' ');
          const reg = it.reg?.trim() ? ` · ${it.reg}` : '';
          const nick = it.nickname?.trim() ? ` — ${it.nickname}` : '';
          li.innerHTML = `<i class="fa-solid fa-car"></i><span>${title}${reg}${nick}</span><span>${date}</span>`;
          li.addEventListener('click', () => {
            location.hash = '#vehicles';
            hideResults();
            setTimeout(() => input.blur(), 0);
          });
        } else if (it.kind === 'Pet') {
          const date = new Date(it.updated_at).toLocaleString();
          const species = it.species ? ` · ${it.species}` : '';
          li.innerHTML = `<i class="fa-solid fa-paw"></i><span>${it.name}${species}</span><span>${date}</span>`;
          li.addEventListener('click', () => {
            location.hash = '#pets';
            hideResults();
            setTimeout(() => input.blur(), 0);
          });
        }
        list.appendChild(li);
      });

      if (items.length === 100) {
        const load = document.createElement('div');
        load.className = 'omnibox__load-more';
        load.textContent = 'Load more';
        load.onclick = () => {
          offset += 100;
          run(current, true);
        };
        panel.appendChild(load);
      }

      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      positionResults();
      if (!append) {
        const msg = items.length === 0
          ? `No results for ${q}`
          : items.length === 100
            ? `100 or more results for ${q}`
            : `${items.length} results for ${q}`;
        announce(msg);
      }
      const took = Math.round(performance.now() - start);
      log.debug('search:render', { count: items.length, append, offset, took_ms: took });
    }

    input.addEventListener('input', () => {
      const MINLEN = Number(import.meta.env.VITE_SEARCH_MINLEN ?? '2');
      const q = input.value.trim();
      current = q;
      offset = 0;
      log.debug('search:input', { q, len: q.length });
      if (timer) clearTimeout(timer);
      if (!q) {
        hideResults();
        return;
      }
      if (q.length < MINLEN) {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        live.textContent = '';
        log.debug('search:bypass', { q, len: q.length });
        return;
      }
      timer = window.setTimeout(() => run(q), 200);
    });

    input.addEventListener('keydown', (e) => {
      const options = Array.from(list.querySelectorAll<HTMLLIElement>('li[role="option"]'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (panel.hidden || !options.length) return;
        e.preventDefault();
        activeIndex = e.key === 'ArrowDown' ? Math.min(activeIndex + 1, options.length - 1) : Math.max(activeIndex - 1, 0);
        options.forEach((el, i) => {
          const active = i === activeIndex;
          el.classList.toggle('is-active', active);
          el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (activeIndex >= 0) {
          const id = options[activeIndex].id || `omnix-option-${activeIndex}`;
          options[activeIndex].id = id;
          input.setAttribute('aria-activedescendant', id);
          options[activeIndex].scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        if (!panel.hidden && activeIndex >= 0 && options[activeIndex]) {
          e.preventDefault();
          options[activeIndex].click();
        } else {
          if (timer) clearTimeout(timer);
          const q = input.value.trim();
          current = q;
          offset = 0;
          const MINLEN = Number(import.meta.env.VITE_SEARCH_MINLEN ?? '2');
          if (!q) {
            hideResults();
            return;
          }
          if (q.length < MINLEN) {
            panel.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            live.textContent = '';
            return;
          }
          run(q);
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        hideResults();
      }
    });

    const omniboxWrapper = input.closest('.omnibox');
    document.addEventListener('click', (e) => {
      const t = e.target as Node;
      if (!panel.contains(t) && !(omniboxWrapper?.contains(t))) {
        hideResults();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== input && !panel.contains(document.activeElement)) {
          hideResults();
        }
      }, 100);
    });

    window.addEventListener('resize', () => {
      if (!panel.hidden) positionResults();
    });
    window.addEventListener('scroll', () => {
      if (!panel.hidden) positionResults();
    }, { passive: true });
  linkDashboard()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("dashboard");
  });
  linkCalendar()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("calendar");
  });
  linkFiles()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("files");
  });
  linkNotes()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("notes");
  });
  linkManage()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("manage");
  });
  document
    .querySelector<HTMLAnchorElement>("#footer-settings")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("settings");
    });
  // Load the route from the URL fragment or fall back to the dashboard view.
  navigate(routeFromHashOrDefault());
  window.addEventListener("hashchange", () =>
    navigate(routeFromHashOrDefault())
  );
  requestAnimationFrame(() => {
    console.log("Runtime window label:", appWindow.label);
    setupDynamicMinSize();
  });
});

// minimal debug handle without ts-expect-error
const DEV = import.meta.env.DEV ?? false;
if (DEV) {
  (window as any).__win = {
    label: (appWindow as any).label,
    setMin: (w = 1200, h = 800) => appWindow.setMinSize(new LogicalSize(w, h)),
    setSize: (w = 1200, h = 800) => appWindow.setSize(new LogicalSize(w, h)),
  };
  console.log("__win ready:", (appWindow as any).label);
}
