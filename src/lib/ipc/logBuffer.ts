export type IpcLogAdapter = "tauri" | "fake";

export interface IpcLogEntry {
  adapter: IpcLogAdapter;
  command: string;
  payloadKeys: string[];
  success: boolean;
  durationMs: number;
  timestamp: string;
  error?: string;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function payloadKeysOf(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  try {
    return Object.keys(payload as Record<string, unknown>).sort();
  } catch {
    return [];
  }
}

export class IpcLogBuffer {
  private readonly entries: IpcLogEntry[] = [];

  constructor(private readonly adapter: IpcLogAdapter, private readonly limit: number) {}

  start(command: string, payload: unknown): { finish: (result: { success: boolean; error?: unknown }) => void } {
    const startedAt = nowMs();
    const payloadKeys = payloadKeysOf(payload);
    const timestamp = new Date().toISOString();

    return {
      finish: ({ success, error }) => {
        const elapsed = nowMs() - startedAt;
        const entry: IpcLogEntry = {
          adapter: this.adapter,
          command,
          payloadKeys,
          success,
          durationMs: Math.round(elapsed * 100) / 100,
          timestamp,
        };
        if (!success && error) {
          entry.error = error instanceof Error ? error.message : String(error);
        }
        this.record(entry);
      },
    };
  }

  private record(entry: IpcLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.shift();
    }
  }

  dump(): IpcLogEntry[] {
    return [...this.entries];
  }
}

export function attachGlobalDump(
  key: "__ARKLOWDUN_TEST_ADAPTER__" | "__ARKLOWDUN_TAURI_ADAPTER__",
  dump: () => IpcLogEntry[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const host = window as unknown as Record<string, Record<string, unknown>>;
  const existing = host[key] ?? {};
  host[key] = {
    ...existing,
    dumpLogs: dump,
  };
}
