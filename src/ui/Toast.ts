export interface ToastHost {
  root: HTMLElement;
  show(message: string, timeout?: number): void;
  clear(): void;
}

export function createToastHost(): ToastHost {
  const root = document.createElement("div");
  root.className = "ui-toast";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  let timer: number | null = null;

  function clear(): void {
    root.textContent = "";
    root.classList.remove("is-visible");
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function show(message: string, timeout = 3000): void {
    clear();
    root.textContent = message;
    root.classList.add("is-visible");
    timer = window.setTimeout(() => {
      clear();
    }, timeout);
  }

  return { root, show, clear };
}
