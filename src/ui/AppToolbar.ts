// src/ui/AppToolbar.ts
import { getCurrentWindow } from "@tauri-apps/api/window";

export function mountMacToolbar(host: HTMLElement): void {
  const win = getCurrentWindow();

  const bar = document.createElement("header");
  bar.className = "app-toolbar";
  bar.setAttribute("data-tauri-drag-region", "true");

  // Resolve app logo for use in the toolbar brand
  const logoUrl = new URL("../assets/logo.svg", import.meta.url).href;

  bar.innerHTML = `
    <div class="traffic" aria-label="Window controls">
      <button class="traffic__btn traffic__close" title="Close" data-tauri-drag-region="false"></button>
      <button class="traffic__btn traffic__min" title="Minimize" data-tauri-drag-region="false"></button>
      <button class="traffic__btn traffic__max" title="Zoom" data-tauri-drag-region="false"></button>
    </div>
    <div class="toolbar__spacer" data-tauri-drag-region="true"></div>
    <div class="toolbar-brand" data-tauri-drag-region="false" aria-label="Application">
      <img class="brand__logo" alt="" src="${logoUrl}" />
      <span class="brand__title">Arklowdun</span>
    </div>
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
  // Optional: toolbar background image slice via data attributes on <body>.
  // Drop your image into the app's "public/" directory and set
  // <body data-toolbar-bg="/toolbar-bg.jpg"> (or .png).
  const bg = document.body?.dataset?.toolbarBg;
  if (bg) {
    // Apply directly to ensure visibility across engines
    bar.style.backgroundImage = `url("${bg}")`;
    bar.style.backgroundSize = document.body?.dataset?.toolbarBgSize ?? "cover";
    bar.style.backgroundPosition = document.body?.dataset?.toolbarBgPosition ?? "center center";
    bar.style.backgroundRepeat = document.body?.dataset?.toolbarBgRepeat ?? "no-repeat";
    // Also expose as CSS variables for theme overrides if desired
    bar.style.setProperty("--toolbar-bg-image", `url("${bg}")`);
    bar.style.setProperty("--toolbar-bg-size", bar.style.backgroundSize);
    bar.style.setProperty("--toolbar-bg-position", bar.style.backgroundPosition);
    bar.style.setProperty("--toolbar-bg-repeat", bar.style.backgroundRepeat);
  }
  // Respect the CSS variable driven height.
}
