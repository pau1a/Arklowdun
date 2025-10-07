import type { AppPane } from "../store";
import { createThemeToggle } from "@ui/ThemeToggle";

type IconVariant = "solid" | "regular";

const ICON_VARIANT_CLASS: Record<IconVariant, string> = {
  solid: "fa-solid",
  regular: "fa-regular",
};

export interface FooterIconConfig {
  name: string;
  variant: IconVariant;
}

export interface FooterItemConfig {
  id: AppPane;
  label: string;
  href: string;
  ariaLabel?: string;
  title?: string;
  className?: string;
  anchorId?: string;
  icon: FooterIconConfig;
}

interface FooterEntry {
  item: FooterItemConfig;
  link: HTMLAnchorElement;
  icon: HTMLElement | null;
}

export interface FooterInstance {
  element: HTMLElement;
  setActive(id: AppPane | null): void;
  getLink(id: AppPane): HTMLAnchorElement | undefined;
}

export function Footer(items: FooterItemConfig[]): FooterInstance {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.setAttribute("role", "contentinfo");

  const entries = new Map<AppPane, FooterEntry>();

  if (items.length) {
    const primaryItem = items[0];
    const anchor = document.createElement("a");
    anchor.id = primaryItem.anchorId ?? `footer-${primaryItem.id}`;
    anchor.href = primaryItem.href;
    anchor.className = primaryItem.className ?? "";
    anchor.title = primaryItem.title ?? "";
    if (primaryItem.ariaLabel) anchor.setAttribute("aria-label", primaryItem.ariaLabel);

    const icon = document.createElement("i");
    icon.className = `${ICON_VARIANT_CLASS[primaryItem.icon.variant]} ${primaryItem.icon.name}`;
    icon.setAttribute("aria-hidden", "true");
    anchor.appendChild(icon);

    const span = document.createElement("span");
    span.textContent = primaryItem.label;
    span.className = "footer__label hide-sm";
    anchor.appendChild(span);

    footer.appendChild(anchor);
    entries.set(primaryItem.id, { item: primaryItem, link: anchor, icon });
  }

  const utilities = document.createElement("div");
  utilities.className = "footer__utilities";

  const notifications = document.createElement("button");
  notifications.type = "button";
  notifications.id = "footer-notifications";
  notifications.title = "Notifications";
  notifications.setAttribute("aria-label", "Notifications");
  const bell = document.createElement("i");
  bell.className = "fa-regular fa-bell";
  bell.setAttribute("aria-hidden", "true");
  notifications.appendChild(bell);
  utilities.appendChild(notifications);

  const diagnostics = document.createElement("button");
  diagnostics.type = "button";
  diagnostics.id = "footer-logs";
  diagnostics.title = "Open logs";
  diagnostics.setAttribute("aria-label", "Open logs");
  diagnostics.classList.add("footer__logs");
  const bug = document.createElement("i");
  bug.className = "fa-regular fa-bug";
  bug.setAttribute("aria-hidden", "true");
  diagnostics.appendChild(bug);
  utilities.appendChild(diagnostics);

  const focusableDiagnostics = diagnostics as HTMLButtonElement;

  const navigateToLogs = () => {
    if (location.hash === "#/logs") return;
    location.hash = "#/logs";
  };

  focusableDiagnostics.addEventListener("click", (event) => {
    event.preventDefault();
    navigateToLogs();
  });

  focusableDiagnostics.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    navigateToLogs();
  });

  const help = document.createElement("button");
  help.type = "button";
  help.title = "Help";
  help.setAttribute("aria-label", "Help");
  const question = document.createElement("i");
  question.className = "fa-regular fa-circle-question";
  question.setAttribute("aria-hidden", "true");
  help.appendChild(question);
  utilities.appendChild(help);

  const toggle = createThemeToggle();
  toggle.element.classList.add("grow-xs");
  utilities.appendChild(toggle.element);

  footer.appendChild(utilities);

  function setActive(id: AppPane | null) {
    entries.forEach((entry, key) => {
      const isActive = key === id;
      entry.link.classList.toggle("is-current", isActive);
      if (isActive) entry.link.setAttribute("aria-current", "page");
      else entry.link.removeAttribute("aria-current");
    });

    const isLogs = id === "logs";
    diagnostics.classList.toggle("is-current", isLogs);
    if (isLogs) diagnostics.setAttribute("aria-current", "page");
    else diagnostics.removeAttribute("aria-current");
  }

  function getLink(id: AppPane): HTMLAnchorElement | undefined {
    return entries.get(id)?.link;
  }

  return { element: footer, setActive, getLink };
}

