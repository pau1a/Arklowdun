export type EmptyStateOpts = {
  title: string;              // e.g., "No bills"
  description?: string;       // e.g., "New bills will appear here."
  actionLabel?: string;       // e.g., "Add bill"
  onAction?: () => void;      // handler for the CTA
  icon?: string;              // optional emoji or icon class
  id?: string;                // optional identifier for tests/greps
};

export function createEmptyState(opts: EmptyStateOpts): HTMLElement {
  const root = document.createElement("div");
  root.className = "empty-state";
  if (opts.id) root.id = opts.id;
  root.setAttribute("role", "status");       // non-blocking, minimal a11y
  root.setAttribute("aria-live", "polite");

  if (opts.icon) {
    const i = document.createElement("div");
    i.className = "empty-state__icon";
    i.textContent = opts.icon;               // keep simple; no external assets
    root.appendChild(i);
  }

  const h = document.createElement("h3");
  h.className = "empty-state__title";
  h.textContent = opts.title;
  root.appendChild(h);

  if (opts.description) {
    const p = document.createElement("p");
    p.className = "empty-state__desc";
    p.textContent = opts.description;
    root.appendChild(p);
  }

  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement("button");
    btn.className = "empty-state__action";
    btn.textContent = opts.actionLabel;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      opts.onAction?.();
    });
    root.appendChild(btn);
  }

  return root;
}
