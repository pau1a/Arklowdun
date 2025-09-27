// src/ui/AppToolbar.ts
import { getCurrentWindow } from "@tauri-apps/api/window";

export function mountMacToolbar(host: HTMLElement): void {
  const win = getCurrentWindow();

  const bar = document.createElement("header");
  bar.className = "app-toolbar";
  bar.setAttribute("data-tauri-drag-region", "true");

  bar.innerHTML = `
    <div class="traffic" aria-label="Window controls">
      <button class="traffic__btn traffic__close" title="Close" data-tauri-drag-region="false"></button>
      <button class="traffic__btn traffic__min" title="Minimize" data-tauri-drag-region="false"></button>
      <button class="traffic__btn traffic__max" title="Zoom" data-tauri-drag-region="false"></button>
    </div>
    <div class="toolbar__spacer" data-tauri-drag-region="true"></div>
    <button class="dog-pill" title="Dog" aria-label="Dog" data-tauri-drag-region="false">
      <i class="fa-solid fa-dog" aria-hidden="true"></i>
      <span class="dog-pill__label">Dog</span>
    </button>
  `;

  const query = (selector: string) => bar.querySelector<HTMLButtonElement>(selector)!;

  query(".traffic__close").addEventListener("click", () => {
    void win.close();
  });

  query(".traffic__min").addEventListener("click", () => {
    void win.minimize();
  });

  query(".traffic__max").addEventListener("click", async () => {
    (await win.isMaximized()) ? await win.unmaximize() : await win.maximize();
  });

  host.prepend(bar);
  // When using a decorated window with overlay title bar (macOS),
  // hide our faux traffic lights and leave room for the native ones.
  void (async () => {
    try {
      const decorated = await win.isDecorated();
      if (decorated) {
        document.documentElement.classList.add("titlebar-overlay");
      } else {
        document.documentElement.classList.remove("titlebar-overlay");
      }
    } catch {
      // ignore API errors in non-tauri contexts
    }
  })();
  // Dog pill interaction: simple popup
  const dogBtn = bar.querySelector<HTMLButtonElement>(".dog-pill");
  dogBtn?.addEventListener("click", () => {
    // keep it simple per request
    alert("woof!");
  });
  // Respect the CSS variable driven height.
}
