// Simple tabbed UI scaffold for Arklowdun

// Ensure SCSS is compiled by Vite:
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
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
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
  | "settings";

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

function requiredLogicalSize(): { w: number; h: number } {
  const appEl = document.body;
  const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
  const minContentWidth = 720;
  const minContentHeight = 480;
  if (!sidebarEl) return { w: minContentWidth, h: minContentHeight };
  const appRect = appEl.getBoundingClientRect();
  const sidebarRect = sidebarEl.getBoundingClientRect();
  const w = Math.ceil(sidebarRect.width + minContentWidth);
  const h = Math.ceil(Math.max(appRect.height, minContentHeight));
  return { w, h };
}

let raf: number | null = null;

async function enforceMinNow() {
  const { w, h } = requiredLogicalSize();
  try {
    await appWindow.setMinSize(new LogicalSize(w, h));

    const current = await appWindow.innerSize();
    const sf = await appWindow.scaleFactor();
    const curW = current.width / sf;
    const curH = current.height / sf;
    if (curW < w || curH < h) {
      await appWindow.setSize(
        new LogicalSize(Math.max(curW, w), Math.max(curH, h))
      );
    }
  } catch (e) {
    console.warn("enforceMinNow failed", e);
  }
}

function setupDynamicMinSize() {
  const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebarEl) return;
  const ro = new ResizeObserver(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      enforceMinNow();
    });
  });
  ro.observe(sidebarEl);
  document.addEventListener("sidebar:toggled", enforceMinNow);
  enforceMinNow();
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
  const title = to.charAt(0).toUpperCase() + to.slice(1);
  renderBlank(title);
}

window.addEventListener("DOMContentLoaded", () => {
  linkDashboard()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("dashboard");
  });
  linkPrimary()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("primary");
  });
  linkSecondary()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("secondary");
  });
  linkTertiary()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("tertiary");
  });
  linkCalendar()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("calendar");
  });
  linkFiles()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("files");
  });
  linkShopping()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("shopping");
  });
  linkBills()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("bills");
  });
  linkInsurance()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("insurance");
  });
  linkProperty()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("property");
  });
  linkVehicles()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("vehicles");
  });
  linkPets()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("pets");
  });
  linkFamily()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("family");
  });
  linkInventory()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("inventory");
  });
  linkBudget()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("budget");
  });
  linkNotes()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("notes");
  });
  linkSettings()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("settings");
  });
  navigate("dashboard");
  // Next tick so the DOM has painted at least once
  requestAnimationFrame(() => {
    console.log("Runtime window label:", appWindow.label);
    setupDynamicMinSize();
  });
});
