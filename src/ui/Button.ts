export type ButtonVariant = "primary" | "ghost" | "neutral";

export interface ButtonOptions {
  variant?: ButtonVariant;
  icon?: string;
  onClick?: (event: MouseEvent) => void;
}

export function createButton(
  label: string,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button";

  const variant = options.variant ?? "neutral";
  button.dataset.variant = variant;

  if (options.icon) {
    const icon = document.createElement("i");
    icon.className = `ui-button__icon ${options.icon}`;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  }

  const text = document.createElement("span");
  text.className = "ui-button__label";
  text.textContent = label;
  button.append(text);

  if (options.onClick) {
    button.addEventListener("click", options.onClick);
  }

  return button;
}
