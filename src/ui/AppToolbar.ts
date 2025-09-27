// src/ui/AppToolbar.ts

type TauriWin = {
  isMaximized: () => Promise<boolean>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  startDragging: () => Promise<void>;
  isDecorated?: () => Promise<boolean>;
};

async function resolveWindow(): Promise<TauriWin> {
  try {
    const mod: any = await import("@tauri-apps/api/window");
    if (typeof mod.getCurrent === "function") {
      return mod.getCurrent() as TauriWin;
    }
    if (typeof mod.getCurrentWindow === "function") {
      return mod.getCurrentWindow() as TauriWin;
    }
  } catch {
    // ignore — fallback below
  }

  const globalWindow = (window as unknown as {
    __TAURI__?: { window?: Record<string, () => TauriWin> };
  }).__TAURI__?.window;

  if (typeof globalWindow?.getCurrent === "function") {
    return globalWindow.getCurrent();
  }

  if (typeof globalWindow?.getCurrentWindow === "function") {
    return globalWindow.getCurrentWindow();
  }

  throw new Error("Cannot resolve Tauri window API (ESM and global both unavailable).");
}

export async function mountMacToolbar(host: HTMLElement): Promise<void> {
  let win: TauriWin;
  try {
    win = await resolveWindow();
  } catch (error) {
    console.error("[AppToolbar] window API not available:", error);
    return;
  }

  const bar = document.createElement("header");
  bar.className = "app-toolbar";
  bar.setAttribute("data-tauri-drag-region", "true");

  bar.innerHTML = `
    <div class="traffic" aria-label="Window controls">
      <button class="traffic__btn traffic__close" title="Close" data-tauri-drag-region="false" aria-label="Close"></button>
      <button class="traffic__btn traffic__min" title="Minimize" data-tauri-drag-region="false" aria-label="Minimize"></button>
      <button class="traffic__btn traffic__max" title="Zoom" data-tauri-drag-region="false" aria-label="Zoom"></button>
    </div>
  `;

  bar.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest(
      "button, a, input, textarea, select, [data-tauri-drag-region='false']",
    );
    if (interactive || event.button !== 0) return;

    event.preventDefault();
    requestAnimationFrame(() => {
      void win.startDragging().catch(() => {
        // no-op: dragging may fail if window API becomes unavailable mid-gesture
      });
    });
  });

  bar.addEventListener("dblclick", async (event) => {
    if (
      (event.target as HTMLElement).closest(
        "[data-tauri-drag-region='false']",
      )
    ) {
      return;
    }

    (await win.isMaximized()) ? await win.unmaximize() : await win.maximize();
  });

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

  void (async () => {
    try {
      const decorated = await (win.isDecorated?.() ?? Promise.resolve(undefined));
      console.log("[AppToolbar] mounted. decorated?:", decorated);
    } catch {
      // no-op
    }
  })();
}
