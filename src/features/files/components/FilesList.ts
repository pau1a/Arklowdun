import { useFilesList } from "@features/files/hooks/useFilesList";
import type { FilesListState } from "@features/files/hooks/useFilesList";
import { createButton } from "@ui/Button";
import { createEmptyState } from "@ui/Empty";
import { createErrorState } from "@ui/ErrorState";
import { createLoadingIndicator } from "@ui/LoadingIndicator";

export interface FilesListOptions {
  initialDirectory?: string;
}

export function createFilesListPanel(
  options: FilesListOptions = {},
): HTMLElement {
  const controller = useFilesList(options.initialDirectory ?? ".");

  const container = document.createElement("section");
  container.className = "feature-files";

  const header = document.createElement("div");
  header.className = "feature-files__header";

  const title = document.createElement("h2");
  title.textContent = "Files";
  header.append(title);

  const currentPath = document.createElement("p");
  currentPath.className = "feature-files__path";
  header.append(currentPath);

  const controls = document.createElement("div");
  controls.className = "feature-files__controls";

  const refreshButton = createButton("Refresh", {
    variant: "primary",
    icon: "fa-solid fa-rotate",
    onClick: () => {
      void controller.load();
    },
  });
  const emptyButton = createButton("Show empty", {
    variant: "ghost",
    onClick: () => controller.simulateEmpty(),
  });
  const errorButton = createButton("Show error", {
    variant: "ghost",
    onClick: () => controller.simulateError("Unable to reach files service"),
  });

  controls.append(refreshButton, emptyButton, errorButton);

  const content = document.createElement("div");
  content.className = "feature-files__content";

  container.append(header, controls, content);

  const renderState = (state: FilesListState): HTMLElement => {
    switch (state.status) {
      case "loading":
        return createLoadingIndicator({ label: "Loading files…" });
      case "error":
        return createErrorState({
          title: "Unable to load files",
          description: state.error ?? "Unknown error",
          retry: () => void controller.load(),
        });
      case "empty":
        return createEmptyState({
          title: "No files yet",
          description: "Drop files into the attachments folder, then refresh.",
          action: {
            label: "Refresh",
            onAction: () => void controller.load(),
          },
        });
      case "ready": {
        const table = document.createElement("table");
        table.className = "feature-files__table";
        const head = document.createElement("thead");
        head.innerHTML = "<tr><th>Name</th><th>Type</th></tr>";
        table.append(head);

        const body = document.createElement("tbody");
        for (const entry of state.entries) {
          const row = document.createElement("tr");
          const nameCell = document.createElement("td");
          nameCell.textContent = entry.name;
          const kindCell = document.createElement("td");
          kindCell.textContent = entry.kind === "directory" ? "Folder" : "File";
          row.append(nameCell, kindCell);
          body.append(row);
        }
        table.append(body);
        return table;
      }
      default:
        return document.createElement("div");
    }
  };

  const render = (state: FilesListState): void => {
    currentPath.textContent = `Path: ${state.path || "."}`;
    content.replaceChildren(renderState(state));
  };

  controller.subscribe(render);

  return container;
}
