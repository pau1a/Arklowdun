import type { AppPane } from "../store";
import { formatShortcut } from "@ui/keys";

type IconVariant = "solid" | "regular";

const ICON_VARIANT_CLASS: Record<IconVariant, string> = {
  solid: "fa-solid",
  regular: "fa-regular",
};

export interface SidebarIconConfig {
  name: string;
  defaultVariant: IconVariant;
  activeVariant?: IconVariant;
  fixed?: boolean;
}

export interface SidebarItemConfig {
  id: AppPane;
  label: string;
  href: string;
  ariaLabel?: string;
  className?: string;
  icon: SidebarIconConfig;
  section: "hub" | "primary";
}

export interface SidebarProps {
  hubItems: SidebarItemConfig[];
  primaryItems: SidebarItemConfig[];
}

interface SidebarEntry {
  item: SidebarItemConfig;
  link: HTMLAnchorElement;
  icon: HTMLElement | null;
}

export interface SidebarInstance {
  element: HTMLElement;
  setActive(id: AppPane | null): void;
  getLink(id: AppPane): HTMLAnchorElement | undefined;
}

function setIconVariant(icon: HTMLElement, variant: IconVariant) {
  icon.classList.remove(ICON_VARIANT_CLASS.solid, ICON_VARIANT_CLASS.regular);
  icon.classList.add(ICON_VARIANT_CLASS[variant]);
}

function createLink(item: SidebarItemConfig): SidebarEntry {
  const link = document.createElement("a");
  link.id = `nav-${item.id}`;
  link.href = item.href;
  link.className = item.className ?? "";
  link.dataset.routeId = item.id;
  if (item.ariaLabel) link.setAttribute("aria-label", item.ariaLabel);

  const icon = document.createElement("i");
  icon.className = `nav__icon ${ICON_VARIANT_CLASS[item.icon.defaultVariant]} ${item.icon.name}`;
  icon.setAttribute("aria-hidden", "true");
  if (item.icon.fixed) icon.dataset.fixed = "true";
  link.appendChild(icon);

  const label = document.createElement("span");
  label.textContent = item.label;
  link.appendChild(label);

  return { item, link, icon };
}

const logoUrl = new URL("../assets/logo.svg", import.meta.url).href;

export function Sidebar(props: SidebarProps): SidebarInstance {
  const aside = document.createElement("aside");
  aside.className = "sidebar";
  aside.setAttribute("aria-label", "Primary");

  const top = document.createElement("div");
  top.className = "sidebar__top";
  aside.appendChild(top);

  const brand = document.createElement("div");
  brand.className = "brand";
  const logo = document.createElement("img");
  logo.src = logoUrl;
  logo.alt = "";
  logo.className = "brand__logo";
  brand.appendChild(logo);

  const title = document.createElement("h1");
  title.textContent = "Arklowdun";
  brand.appendChild(title);
  top.appendChild(brand);

  const entries = new Map<AppPane, SidebarEntry>();

  props.hubItems.forEach((item) => {
    const entry = createLink(item);
    entries.set(item.id, entry);
    top.appendChild(entry.link);
  });

  if (props.hubItems.length && props.primaryItems.length) {
    const divider = document.createElement("div");
    divider.className = "sidebar__divider";
    divider.setAttribute("aria-hidden", "true");
    top.appendChild(divider);
  }

  const nav = document.createElement("nav");
  nav.className = "nav";
  nav.setAttribute("aria-label", "Primary");

  props.primaryItems.forEach((item) => {
    const entry = createLink(item);
    entries.set(item.id, entry);
    nav.appendChild(entry.link);
  });

  top.appendChild(nav);

  const searchButton = document.createElement("button");
  searchButton.id = "sidebar-search";
  searchButton.type = "button";
  searchButton.className = "sidebar__cmd-button";
  const shortcut = formatShortcut("K");
  searchButton.title = `Search (${shortcut})`;
  searchButton.setAttribute("aria-label", `Search (${shortcut})`);
  const searchIcon = document.createElement("i");
  searchIcon.className = "fa-solid fa-magnifying-glass";
  searchIcon.setAttribute("aria-hidden", "true");
  searchButton.appendChild(searchIcon);
  aside.appendChild(searchButton);

  entries.forEach(({ icon, item }) => {
    if (!icon) return;
    setIconVariant(icon, item.icon.defaultVariant);
  });

  function setActive(id: AppPane | null) {
    entries.forEach((entry, key) => {
      const isActive = key === id;
      entry.link.classList.toggle("active", isActive);
      if (isActive) entry.link.setAttribute("aria-current", "page");
      else entry.link.removeAttribute("aria-current");

      if (entry.item.section === "hub") {
        entry.link.classList.toggle("is-current", isActive);
      }

      if (!entry.icon) return;
      if (entry.item.icon.fixed) return;
      const variant = isActive
        ? entry.item.icon.activeVariant ?? entry.item.icon.defaultVariant
        : entry.item.icon.defaultVariant;
      setIconVariant(entry.icon, variant);
    });
  }

  function getLink(id: AppPane): HTMLAnchorElement | undefined {
    return entries.get(id)?.link;
  }

  return { element: aside, setActive, getLink };
}

