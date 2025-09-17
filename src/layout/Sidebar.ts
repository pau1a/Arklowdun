import { createButton } from "@ui/Button";
import type { Pane } from "@store/appStore";

export interface SidebarItem {
  pane: Pane;
  label: string;
  icon?: string;
}

export interface SidebarShell {
  root: HTMLElement;
  setActive(pane: Pane): void;
}

export function createSidebarShell(
  items: SidebarItem[],
  onSelect: (pane: Pane) => void,
): SidebarShell {
  const root = document.createElement("nav");
  root.className = "app-sidebar";

  const buttons = new Map<Pane, HTMLButtonElement>();

  for (const item of items) {
    const button = createButton(item.label, {
      variant: "ghost",
      icon: item.icon,
      onClick: () => onSelect(item.pane),
    });
    button.classList.add("app-sidebar__item");
    button.setAttribute("data-pane", item.pane);
    buttons.set(item.pane, button);
    root.append(button);
  }

  function setActive(pane: Pane): void {
    for (const [key, btn] of buttons.entries()) {
      btn.classList.toggle("is-active", key === pane);
    }
  }

  return { root, setActive };
}
