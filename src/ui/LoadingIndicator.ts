export interface LoadingIndicatorOptions {
  label?: string;
}

export function createLoadingIndicator(
  options: LoadingIndicatorOptions = {},
): HTMLElement {
  const container = document.createElement("div");
  container.className = "ui-loading";

  const spinner = document.createElement("span");
  spinner.className = "ui-loading__spinner";
  spinner.setAttribute("aria-hidden", "true");
  container.append(spinner);

  const label = document.createElement("span");
  label.className = "ui-loading__label";
  label.textContent = options.label ?? "Loading";
  container.append(label);

  return container;
}
