import "@fortawesome/fontawesome-free/css/all.min.css";
import "./debug";
import "./theme.scss";
import "./styles.scss";

import {
  createContentShell,
  createPageShell,
  createSidebarShell,
  createToolbarShell,
  type SidebarItem,
} from "@layout/index";
import { createCalendarPlaceholder } from "@features/calendar";
import { createFilesListPanel } from "@features/files";
import { createNotesPlaceholder } from "@features/notes";
import { createSettingsPlaceholder } from "@features/settings";
import { appStore } from "@store/index";
import type { AppState, Pane } from "@store/index";
import { createToastHost } from "@ui/Toast";

const root = document.querySelector<HTMLElement>("#app") ?? document.body;
const page = createPageShell();
root.replaceChildren(page.root);

const toastHost = createToastHost();
page.root.append(toastHost.root);

const sidebarItems: SidebarItem[] = [
  { pane: "files", label: "Files", icon: "fa-regular fa-folder-open" },
  { pane: "calendar", label: "Calendar", icon: "fa-regular fa-calendar-days" },
  { pane: "notes", label: "Notes", icon: "fa-regular fa-note-sticky" },
  { pane: "settings", label: "Settings", icon: "fa-solid fa-gear" },
];

const sidebar = createSidebarShell(sidebarItems, (pane) => appStore.setActivePane(pane));
page.sidebar.append(sidebar.root);

const content = createContentShell();
page.content.append(content.root);

const renderPane = (state: AppState): void => {
  sidebar.setActive(state.activePane);
  page.toolbar.replaceChildren(createToolbarShell(titleForPane(state.activePane)));
  content.setView(viewForPane(state.activePane));
};

appStore.subscribe(renderPane);
appStore.markReady();

function viewForPane(pane: Pane): HTMLElement {
  switch (pane) {
    case "files":
      return createFilesListPanel();
    case "calendar":
      return createCalendarPlaceholder();
    case "notes":
      return createNotesPlaceholder();
    case "settings":
    default:
      return createSettingsPlaceholder();
  }
}

function titleForPane(pane: Pane): string {
  switch (pane) {
    case "files":
      return "Files";
    case "calendar":
      return "Calendar";
    case "notes":
      return "Notes";
    case "settings":
      return "Settings";
    default:
      return pane;
  }
}
