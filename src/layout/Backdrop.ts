export interface BackdropInstance {
  element: HTMLElement;
}

// A full-window background layer that sits behind the app shell.
// It uses CSS for visuals (gradient / animations) and ignores pointer events.
export function Backdrop(): BackdropInstance {
  const el = document.createElement("div");
  el.className = "backdrop";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-role", "app-backdrop");
  return { element: el };
}

