import { TauriAdapter } from "./adapters/tauri";
import { TestAdapter, type TestAdapterOptions } from "./adapters/test";
import type { IpcAdapter } from "./port";
import { UNKNOWN_IPC_ERROR_CODE } from "./errors";

type AdapterName = "tauri" | "fake";

const envRecord =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const mode = envRecord.MODE ?? envRecord.VITE_ENV ?? "development";
const isTestMode = mode === "test";

const forcedAdapterName: AdapterName | undefined = isTestMode
  ? "fake"
  : (envRecord.VITE_IPC_ADAPTER as AdapterName | undefined);

const forcedScenarioName = (() => {
  if (!isTestMode && !envRecord.VITE_IPC_SCENARIO) return undefined;
  const candidate = envRecord.VITE_IPC_SCENARIO?.trim();
  if (candidate) return candidate;
  return isTestMode ? "defaultHousehold" : undefined;
})();

let activeAdapter: IpcAdapter | undefined;
let activeName: AdapterName | undefined;
let activeTestOptions: TestAdapterOptions | undefined;

function resolveAdapterName(): AdapterName {
  if (forcedAdapterName) {
    return forcedAdapterName;
  }

  const envAdapter = envRecord.VITE_IPC_ADAPTER as AdapterName | undefined;
  if (envAdapter === "fake" || envAdapter === "tauri") {
    return envAdapter;
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

  // In non-production dev/preview browser sessions, default to the fake adapter
  // so the UI can boot without Tauri present (e.g. opening http://localhost:1420).
  const isDev = mode !== "production";
  if (isDev) {
    console.warn(
      "[ipc] no Tauri bridge detected — defaulting to fake adapter in %s mode",
      mode,
    );
    return "fake";
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

function mergeTestOptions(options?: TestAdapterOptions): TestAdapterOptions | undefined {
  const scenario = options?.scenarioName ?? forcedScenarioName;
  if (!scenario && !options) return undefined;
  const merged: TestAdapterOptions = { ...(options ?? {}) };
  if (scenario && !merged.scenarioName) {
    merged.scenarioName = scenario;
  }
  return merged;
}

function createAdapter(name: AdapterName, options?: TestAdapterOptions): IpcAdapter {
  if (name === "fake") {
    const merged = mergeTestOptions(options);
    activeTestOptions = merged;
    return new TestAdapter(merged);
  }
  activeTestOptions = undefined;
  return new TauriAdapter();
}

export function configureIpcAdapter(name: AdapterName, options?: TestAdapterOptions): void {
  activeName = name;
  activeAdapter = createAdapter(name, options);
}

export function getIpcAdapter(): IpcAdapter {
  if (!activeAdapter) {
    const name = resolveAdapterName();
    configureIpcAdapter(name);
  }
  return activeAdapter!;
}

export function getIpcAdapterName(): AdapterName {
  if (!activeAdapter) {
    getIpcAdapter();
  }
  return activeName ?? "tauri";
}

export function getActiveTestScenario(): string | undefined {
  if ((activeName ?? forcedAdapterName) !== "fake") return undefined;
  const scenario = activeTestOptions?.scenarioName ?? forcedScenarioName;
  return scenario ?? envRecord.VITE_IPC_SCENARIO ?? undefined;
}
