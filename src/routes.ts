import { DashboardView } from "./DashboardView";
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
import { ManageView } from "./ManageView";
import type { AppPane } from "./store";
import { ImportModal } from "@ui/ImportModal";

type RoutePlacement = "hub" | "sidebar" | "footer" | "hidden";

type IconVariant = "solid" | "regular";

export interface RouteIconConfig {
  name: string;
  defaultVariant: IconVariant;
  activeVariant?: IconVariant;
  fixed?: boolean;
}

export interface RouteDisplayConfig {
  placement: RoutePlacement;
  label: string;
  ariaLabel?: string;
  className?: string;
  icon?: RouteIconConfig;
}

export interface RouteDefinition {
  id: AppPane;
  hash: `#/${string}`;
  legacyHashes?: string[];
  mount: (container: HTMLElement) => void | Promise<void>;
  display?: RouteDisplayConfig;
}

function renderPlaceholder(container: HTMLElement, _title: string) {
  container.innerHTML = `<section></section>`;
}

function addImportButtonToSettings(container: HTMLElement) {
  const about =
    container.querySelector<HTMLElement>('section[aria-labelledby="settings-about"]') ??
    container;
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

const ROUTE_DEFINITIONS: RouteDefinition[] = [
  {
    id: "manage",
    hash: "#/manage",
    legacyHashes: ["#manage"],
    mount: (container) => ManageView(container),
    display: {
      placement: "hub",
      label: "Manage",
      ariaLabel: "Open Manage",
      className: "manage-link",
      icon: { name: "fa-layer-group", defaultVariant: "solid", activeVariant: "solid", fixed: true },
    },
  },
  {
    id: "dashboard",
    hash: "#/dashboard",
    legacyHashes: ["#dashboard"],
    mount: (container) => DashboardView(container),
    display: {
      placement: "sidebar",
      label: "Dashboard",
      icon: { name: "fa-house", defaultVariant: "solid", activeVariant: "solid", fixed: true },
    },
  },
  {
    id: "calendar",
    hash: "#/calendar",
    legacyHashes: ["#calendar"],
    mount: (container) => CalendarView(container),
    display: {
      placement: "sidebar",
      label: "Calendar",
      icon: { name: "fa-calendar-days", defaultVariant: "regular", activeVariant: "solid" },
    },
  },
  {
    id: "files",
    hash: "#/files",
    legacyHashes: ["#files"],
    mount: (container) => FilesView(container),
    display: {
      placement: "sidebar",
      label: "Files",
      icon: { name: "fa-folder-open", defaultVariant: "regular", activeVariant: "solid" },
    },
  },
  {
    id: "notes",
    hash: "#/notes",
    legacyHashes: ["#notes"],
    mount: (container) => NotesView(container),
    display: {
      placement: "sidebar",
      label: "Notes",
      icon: { name: "fa-note-sticky", defaultVariant: "regular", activeVariant: "solid" },
    },
  },
  {
    id: "settings",
    hash: "#/settings",
    legacyHashes: ["#settings"],
    mount: (container) => {
      SettingsView(container);
      const settingsContainer = container.querySelector<HTMLElement>(".settings");
      if (settingsContainer) addImportButtonToSettings(settingsContainer);
    },
    display: {
      placement: "footer",
      label: "Settings",
      ariaLabel: "Settings",
      className: "footer__settings",
      icon: { name: "fa-gear", defaultVariant: "solid", activeVariant: "solid", fixed: true },
    },
  },
  {
    id: "primary",
    hash: "#/primary",
    legacyHashes: ["#primary"],
    mount: (container) => renderPlaceholder(container, "Primary"),
    display: { placement: "hidden", label: "Primary" },
  },
  {
    id: "secondary",
    hash: "#/secondary",
    legacyHashes: ["#secondary"],
    mount: (container) => renderPlaceholder(container, "Secondary"),
    display: { placement: "hidden", label: "Secondary" },
  },
  {
    id: "tasks",
    hash: "#/tasks",
    legacyHashes: ["#tasks"],
    mount: (container) => renderPlaceholder(container, "Tasks"),
    display: { placement: "hidden", label: "Tasks" },
  },
  {
    id: "shopping",
    hash: "#/shopping",
    legacyHashes: ["#shopping"],
    mount: (container) => ShoppingListView(container),
    display: { placement: "hidden", label: "Shopping" },
  },
  {
    id: "bills",
    hash: "#/bills",
    legacyHashes: ["#bills"],
    mount: (container) => BillsView(container),
    display: { placement: "hidden", label: "Bills" },
  },
  {
    id: "insurance",
    hash: "#/insurance",
    legacyHashes: ["#insurance"],
    mount: (container) => InsuranceView(container),
    display: { placement: "hidden", label: "Insurance" },
  },
  {
    id: "property",
    hash: "#/property",
    legacyHashes: ["#property"],
    mount: (container) => PropertyView(container),
    display: { placement: "hidden", label: "Property" },
  },
  {
    id: "vehicles",
    hash: "#/vehicles",
    legacyHashes: ["#vehicles"],
    mount: (container) => VehiclesView(container),
    display: { placement: "hidden", label: "Vehicles" },
  },
  {
    id: "pets",
    hash: "#/pets",
    legacyHashes: ["#pets"],
    mount: (container) => PetsView(container),
    display: { placement: "hidden", label: "Pets" },
  },
  {
    id: "family",
    hash: "#/family",
    legacyHashes: ["#family"],
    mount: (container) => FamilyView(container),
    display: { placement: "hidden", label: "Family" },
  },
  {
    id: "inventory",
    hash: "#/inventory",
    legacyHashes: ["#inventory"],
    mount: (container) => InventoryView(container),
    display: { placement: "hidden", label: "Inventory" },
  },
  {
    id: "budget",
    hash: "#/budget",
    legacyHashes: ["#budget"],
    mount: (container) => BudgetView(container),
    display: { placement: "hidden", label: "Budget" },
  },
];

const routeById = new Map<AppPane, RouteDefinition>();
const routeByHash = new Map<string, RouteDefinition>();

ROUTE_DEFINITIONS.forEach((route) => {
  routeById.set(route.id, route);
  routeByHash.set(route.hash, route);
  route.legacyHashes?.forEach((hash) => {
    routeByHash.set(hash, route);
  });
});

const DEFAULT_ROUTE = routeById.get("dashboard")!;

function normaliseHash(fragment: string): string {
  const value = fragment.startsWith("#") ? fragment : `#${fragment}`;
  if (value.startsWith("#/")) return value;
  return `#/${value.slice(1)}`;
}

export function resolveRouteFromHash(hash: string | null | undefined): RouteDefinition {
  if (!hash) return DEFAULT_ROUTE;
  const trimmed = hash.trim();
  if (!trimmed) return DEFAULT_ROUTE;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return routeByHash.get(withHash) ?? routeByHash.get(normaliseHash(withHash)) ?? DEFAULT_ROUTE;
}

export function getRouteById(id: AppPane): RouteDefinition | undefined {
  return routeById.get(id);
}

export function getDefaultRoute(): RouteDefinition {
  return DEFAULT_ROUTE;
}

export function getSidebarRoutes(): RouteDefinition[] {
  return ROUTE_DEFINITIONS.filter((route) => route.display?.placement === "sidebar");
}

export function getHubRoutes(): RouteDefinition[] {
  return ROUTE_DEFINITIONS.filter((route) => route.display?.placement === "hub");
}

export function getFooterRoutes(): RouteDefinition[] {
  return ROUTE_DEFINITIONS.filter((route) => route.display?.placement === "footer");
}

export function getAllRoutes(): RouteDefinition[] {
  return [...ROUTE_DEFINITIONS];
}
