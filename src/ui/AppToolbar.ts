// src/ui/AppToolbar.ts
import { getCurrentWindow } from "@tauri-apps/api/window";

export function mountMacToolbar(host: HTMLElement): void {
  const win = getCurrentWindow();

  const bar = document.createElement("header");
  bar.className = "app-toolbar";
  bar.setAttribute("data-tauri-drag-region", "true");

  bar.innerHTML = `
    <div class="traffic" aria-label="Window controls">
      <button class="traffic__btn traffic__close"  title="Close"    data-tauri-drag-region="false"></button>
      <button class="traffic__btn traffic__min"    title="Minimize" data-tauri-drag-region="false"></button>
      <button class="traffic__btn traffic__max"    title="Zoom"     data-tauri-drag-region="false"></button>
    </div>
  `;

  // === Programmatic drag fallback (works even if drag-region is ignored) ===
  // Only start dragging when clicking empty toolbar space (not on a button/input/etc.)
  bar.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    const interactive = target.closest(
      "button, a, input, textarea, select, [data-tauri-drag-region='false']"
    );

    if (!interactive && e.button === 0) {
      void win.startDragging();
    }
  });

  // Hook up the three mac buttons
  const query = (selector: string) => bar.querySelector<HTMLButtonElement>(selector)!;

  query(".traffic__close").addEventListener("click", () => void win.close());
  query(".traffic__min").addEventListener("click", () => void win.minimize());
  query(".traffic__max").addEventListener("click", async () => {
    (await win.isMaximized()) ? await win.unmaximize() : await win.maximize();
  });

  host.prepend(bar);
}
