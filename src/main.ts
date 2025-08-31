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
  | "vehicles"
  | "pets"
  | "family";

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
const linkVehicles = () =>
  document.querySelector<HTMLAnchorElement>("#nav-vehicles");
const linkPets = () => document.querySelector<HTMLAnchorElement>("#nav-pets");
const linkFamily = () =>
  document.querySelector<HTMLAnchorElement>("#nav-family");

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
    vehicles: linkVehicles(),
    pets: linkPets(),
    family: linkFamily(),
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
  navigate("dashboard");
});
