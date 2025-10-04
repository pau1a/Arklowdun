import { TauriAdapter } from "./adapters/tauri";
import { TestAdapter, type TestAdapterOptions } from "./adapters/test";
import type { IpcAdapter } from "./port";
import { UNKNOWN_IPC_ERROR_CODE } from "./errors";

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

  const globalWindow =
    typeof window !== "undefined" ? ((window as unknown) as Record<string, unknown>) : undefined;

  const hasTauriBridge = Boolean(
    globalWindow?.["__TAURI__"] ||
      globalWindow?.["__TAURI_IPC__"] ||
      globalWindow?.["__TAURI_INTERNALS__"] ||
      globalWindow?.["__TAURI_METADATA__"],
  );

  const isTauriUA =
    typeof navigator !== "undefined" && /\bTauri\b/i.test(navigator.userAgent ?? "");

  const isTauriProtocol =
    typeof location !== "undefined" && location.protocol.startsWith("tauri");

  if (hasTauriBridge || isTauriUA || isTauriProtocol) {
    return "tauri";
  }

  const messageParts = [
    "No IPC adapter detected.",
    "Set VITE_IPC_ADAPTER=fake for browser or Playwright runs.",
    "Set VITE_IPC_SCENARIO to one of: defaultHousehold, multipleHouseholds, calendarPopulated, corruptHealth.",
  ];
  const message = messageParts.join(" ");
  const error = new Error(message) as Error & { code?: string };
  error.name = "IpcAdapterResolutionError";
  error.code = UNKNOWN_IPC_ERROR_CODE;
  console.error("[ipc] adapter resolution failed", { message, stack: new Error().stack });
  throw error;
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
