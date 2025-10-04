import { TauriAdapter } from "./adapters/tauri";
import { TestAdapter, type TestAdapterOptions } from "./adapters/test";
import type { IpcAdapter } from "./port";

type AdapterName = "tauri" | "fake";

let activeAdapter: IpcAdapter | undefined;
let activeName: AdapterName | undefined;

function resolveEnv(): AdapterName {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_IPC_ADAPTER === "fake") {
    return "fake";
  }
  if (env?.VITE_IPC_ADAPTER === "tauri") {
    return "tauri";
  }

  const isTauri = typeof window !== "undefined" && typeof navigator !== "undefined" && /\bTauri\b/i.test(navigator.userAgent ?? "");
  return isTauri ? "tauri" : "fake";
}

function createAdapter(name: AdapterName, options?: TestAdapterOptions): IpcAdapter {
  if (name === "fake") {
    return new TestAdapter(options);
  }
  return new TauriAdapter();
}

export function configureIpcAdapter(name: AdapterName, options?: TestAdapterOptions): void {
  activeAdapter = createAdapter(name, options);
  activeName = name;
}

export function getIpcAdapter(): IpcAdapter {
  if (!activeAdapter) {
    configureIpcAdapter(resolveEnv());
  }
  return activeAdapter!;
}

export function getIpcAdapterName(): AdapterName {
  if (!activeAdapter) {
    configureIpcAdapter(resolveEnv());
  }
  return activeName ?? "tauri";
}
