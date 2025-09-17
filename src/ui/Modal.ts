export interface ModalController {
  root: HTMLElement;
  open(content: HTMLElement): void;
  close(): void;
}

export function createModal(): ModalController {
  const root = document.createElement("div");
  root.className = "ui-modal";
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "ui-modal__backdrop";

  const dialog = document.createElement("div");
  dialog.className = "ui-modal__dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  root.append(backdrop, dialog);

  function close(): void {
    root.hidden = true;
    dialog.replaceChildren();
  }

  function open(content: HTMLElement): void {
    dialog.replaceChildren(content);
    root.hidden = false;
  }

  backdrop.addEventListener("click", close);

  return { root, open, close };
}
