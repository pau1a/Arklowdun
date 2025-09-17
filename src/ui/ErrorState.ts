import { createButton } from "./Button";

export interface ErrorStateOptions {
  title: string;
  description?: string;
  retry?: () => void;
}

export function createErrorState(options: ErrorStateOptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "ui-error";

  const title = document.createElement("p");
  title.className = "ui-error__title";
  title.textContent = options.title;
  container.append(title);

  if (options.description) {
    const description = document.createElement("p");
    description.className = "ui-error__description";
    description.textContent = options.description;
    container.append(description);
  }

  if (options.retry) {
    const retryButton = createButton("Retry", {
      variant: "primary",
      onClick: options.retry,
    });
    retryButton.classList.add("ui-error__retry");
    container.append(retryButton);
  }

  return container;
}
