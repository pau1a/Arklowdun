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
}
