import type { SidebarInstance } from "./Sidebar";
import type { ContentInstance } from "./Content";
import type { ToolbarInstance } from "./Toolbar";
import type { FooterInstance } from "./Footer";
import { Backdrop } from "./Backdrop";

export interface PageProps {
  sidebar: SidebarInstance;
  content: ContentInstance;
  footer: FooterInstance;
  toolbar?: ToolbarInstance | null;
}

export interface PageInstance {
  mount(target?: HTMLElement): void;
}

export function Page({ sidebar, content, footer, toolbar }: PageProps): PageInstance {
  // Persistent, app-wide backdrop layer (e.g., gradient) behind all panels.
  const backdrop = Backdrop();
  const modalRoot = document.createElement("div");
  modalRoot.id = "modal-root";

  const liveRegion = document.createElement("div");
  liveRegion.id = "search-live";
  liveRegion.className = "sr-only";
  liveRegion.setAttribute("aria-live", "polite");

  function mount(target: HTMLElement = document.body) {
    if (toolbar && !content.element.contains(toolbar.element)) {
      content.element.prepend(toolbar.element);
    }

    const nextChildren: Node[] = [];

    // Always ensure the backdrop is first so everything else paints above it.
    nextChildren.push(backdrop.element);

    const customToolbar =
      target.querySelector<HTMLElement>(".app-toolbar") ??
      document.querySelector<HTMLElement>(".app-toolbar");
    if (customToolbar) {
      nextChildren.push(customToolbar);
    }

    nextChildren.push(
      sidebar.element,
      content.element,
      footer.element,
      modalRoot,
      liveRegion,
    );

    target.replaceChildren(...nextChildren);
  }

  return { mount };
}
