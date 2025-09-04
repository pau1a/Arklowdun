// Simple tabbed UI scaffold for Arklowdun

// Ensure SCSS is compiled by Vite:
import "./debug";
import "./styles.scss";
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
import { LegacyView } from "./LegacyView";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { defaultHouseholdId } from "./db/household";
const appWindow = getCurrentWindow();

type View =
  | "dashboard"
  | "primary"
  | "secondary"
  | "tertiary"
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
  | "legacy";

const viewEl = () => document.querySelector<HTMLElement>("#view");
const linkDashboard = () =>
  document.querySelector<HTMLAnchorElement>("#nav-dashboard");
const linkPrimary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-primary");
const linkSecondary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-secondary");
const linkTertiary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-tertiary");
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
const linkSettings = () =>
  document.querySelector<HTMLAnchorElement>("#nav-settings");
const linkLegacy = () =>
  document.querySelector<HTMLAnchorElement>("#nav-legacy");

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
    console.warn("enforceMinNow failed", e);
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

function setActive(tab: View) {
  const tabs: Record<View, HTMLAnchorElement | null> = {
    dashboard: linkDashboard(),
    primary: linkPrimary(),
    secondary: linkSecondary(),
    tertiary: linkTertiary(),
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
    settings: linkSettings(),
    legacy: linkLegacy(),
  };
  (Object.keys(tabs) as View[]).forEach((name) => {
    const el = tabs[name];
    const active = name === tab;
    el?.classList.toggle("active", active);
    if (active) el?.setAttribute("aria-current", "page");
    else el?.removeAttribute("aria-current");
  });
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
    return;
  }
  if (to === "legacy") {
    LegacyView(el);
    setupLegacyLinks();
    return;
  }
  const title = to.charAt(0).toUpperCase() + to.slice(1);
  renderBlank(title);
}

function setupLegacyLinks() {
  const pairs: [() => HTMLAnchorElement | null, View][] = [
    [linkPrimary, "primary"],
    [linkSecondary, "secondary"],
    [linkTertiary, "tertiary"],
    [linkBills, "bills"],
    [linkInsurance, "insurance"],
    [linkProperty, "property"],
    [linkVehicles, "vehicles"],
    [linkPets, "pets"],
    [linkFamily, "family"],
    [linkInventory, "inventory"],
    [linkBudget, "budget"],
    [linkShopping, "shopping"],
  ];
  for (const [getter, view] of pairs) {
    const el = getter();
    if (el) {
      el.onclick = (e) => {
        e.preventDefault();
        navigate(view);
      };
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  defaultHouseholdId().catch((e) => console.error("DB init failed:", e));

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
  linkSettings()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("settings");
  });
  linkLegacy()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("legacy");
  });
  navigate("dashboard");
  requestAnimationFrame(() => {
    console.log("Runtime window label:", appWindow.label);
    setupDynamicMinSize();
  });
});

// minimal debug handle without ts-expect-error
const DEV = (import.meta as any)?.env?.DEV ?? false;
if (DEV) {
  (window as any).__win = {
    label: (appWindow as any).label,
    setMin: (w = 1200, h = 800) => appWindow.setMinSize(new LogicalSize(w, h)),
    setSize: (w = 1200, h = 800) => appWindow.setSize(new LogicalSize(w, h)),
  };
  console.log("__win ready:", (appWindow as any).label);
}
