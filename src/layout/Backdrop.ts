export interface BackdropInstance {
  element: HTMLElement;
  ambientHost: HTMLElement;
}

// A full-window background layer that sits behind the app shell.
// It uses CSS for visuals (gradient / animations) and ignores pointer events.
export function Backdrop(): BackdropInstance {
  const el = document.createElement("div");
  el.className = "backdrop";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-role", "app-backdrop");

  const ambientHost = document.createElement("div");
  ambientHost.className = "backdrop__ambient";
  ambientHost.setAttribute("data-role", "ambient-host");
  ambientHost.setAttribute("aria-hidden", "true");

  el.appendChild(ambientHost);

  return { element: el, ambientHost };
}

