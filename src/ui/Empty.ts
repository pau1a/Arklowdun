import { createButton } from "./Button";

export interface EmptyStateAction {
  label: string;
  onAction: () => void;
}

export interface EmptyStateOptions {
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

export function createEmptyState(options: EmptyStateOptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "ui-empty";

  const title = document.createElement("p");
  title.className = "ui-empty__title";
  title.textContent = options.title;
  container.append(title);

  if (options.description) {
    const description = document.createElement("p");
    description.className = "ui-empty__description";
    description.textContent = options.description;
    container.append(description);
  }

  if (options.action) {
    const action = createButton(options.action.label, {
      variant: "primary",
      onClick: options.action.onAction,
    });
    action.classList.add("ui-empty__action");
    container.append(action);
  }

  return container;
}
