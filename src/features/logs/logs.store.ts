import { getTail } from "./logs.api";
import { parseLogLine } from "./logs.parse";
import type { LogEntry, LogLevel, LogWriteStatus } from "./logs.types";

export interface LogsState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  entries: LogEntry[];
  fetchedAtUtc?: string;
  droppedCount: number;
  logWriteStatus: LogWriteStatus;
}

type Listener = (state: LogsState) => void;

type TailFetcher = () => Promise<unknown>;

const MAX_ENTRIES = 200;

const listeners = new Set<Listener>();

const state: LogsState = {
  status: "idle",
  entries: [],
  droppedCount: 0,
  logWriteStatus: "ok",
};

let tailFetcher: TailFetcher = getTail;

function snapshot(): LogsState {
  return {
    status: state.status,
    error: state.error,
    entries: state.entries.slice(),
    fetchedAtUtc: state.fetchedAtUtc,
    droppedCount: state.droppedCount,
    logWriteStatus: state.logWriteStatus,
  };
}

function notify(): void {
  listeners.forEach((listener) => {
    listener(snapshot());
  });
}

function formatError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown };
    if (typeof record.message === "string") {
      return record.message;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error ?? "Unknown error");
  }
}

function setLoading(): void {
  state.status = "loading";
  state.error = undefined;
  notify();
}

function setReady(
  entries: LogEntry[],
  meta: { droppedCount: number; logWriteStatus: LogWriteStatus },
): void {
  state.status = "ready";
  state.error = undefined;
  state.entries = entries;
  state.droppedCount = meta.droppedCount;
  state.logWriteStatus = meta.logWriteStatus;
  state.fetchedAtUtc = new Date().toISOString();
  notify();
}

function setError(message: string): void {
  state.status = "error";
  state.error = message;
  state.entries = [];
  state.fetchedAtUtc = undefined;
  state.droppedCount = 0;
  state.logWriteStatus = "ok";
  notify();
}

interface DiagnosticsSummaryResponse {
  logTail?: unknown;
  logLinesReturned?: unknown;
  logTruncated?: unknown;
  logAvailable?: unknown;
  dropped_count?: unknown;
  droppedCount?: unknown;
  log_write_status?: unknown;
  logWriteStatus?: unknown;
  lines?: (string | Record<string, unknown>)[];
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeTail(lines: unknown): LogEntry[] {
  if (!Array.isArray(lines)) return [];
  const parsed = lines
    .map((line, index) => {
      const entry = parseLogLine(line as string | Record<string, unknown>);
      if (!entry) return null;
      return { entry, index };
    })
    .filter(
      (item): item is { entry: LogEntry; index: number } => item !== null,
    );

  parsed.sort((a, b) => {
    if (b.entry.tsEpochMs !== a.entry.tsEpochMs) {
      return b.entry.tsEpochMs - a.entry.tsEpochMs;
    }
    return a.index - b.index;
  });

  const entries = parsed.slice(0, MAX_ENTRIES).map((item) => item.entry);
  return entries;
}

function pickTailLines(record: DiagnosticsSummaryResponse): unknown {
  if (Array.isArray(record.logTail)) {
    return record.logTail;
  }
  if (Array.isArray(record.lines)) {
    return record.lines;
  }
  return [];
}

function normalizeResponse(
  response: unknown,
): { entries: LogEntry[]; droppedCount: number; logWriteStatus: LogWriteStatus } {
  let tailSource: unknown = [];
  let droppedCount = state.droppedCount ?? 0;
  let logWriteStatus: LogWriteStatus = state.logWriteStatus ?? "ok";

  if (response && typeof response === "object" && !Array.isArray(response)) {
    const record = response as DiagnosticsSummaryResponse;
    tailSource = pickTailLines(record);

    const droppedCandidate =
      toFiniteNumber(record.dropped_count) ?? toFiniteNumber(record.droppedCount);
    if (droppedCandidate !== null) {
      droppedCount = Math.max(0, droppedCandidate);
    } else if (Array.isArray(tailSource)) {
      droppedCount = 0;
    }

    const rawStatus =
      typeof record.log_write_status === "string"
        ? record.log_write_status
        : typeof record.logWriteStatus === "string"
          ? record.logWriteStatus
          : null;
    if (rawStatus !== null) {
      const normalized = rawStatus.trim();
      logWriteStatus = (normalized || "ok") as LogWriteStatus;
    } else if (Array.isArray(tailSource)) {
      logWriteStatus = "ok";
    }
  } else if (Array.isArray(response)) {
    tailSource = response;
    droppedCount = 0;
    logWriteStatus = "ok";
  }

  const entries = normalizeTail(tailSource);
  return { entries, droppedCount, logWriteStatus };
}

export const logsStore = {
  state,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(snapshot());
    return () => {
      listeners.delete(listener);
    };
  },
  async fetchTail(): Promise<void> {
    setLoading();
    try {
      const response = await tailFetcher();
      const result = normalizeResponse(response);
      setReady(result.entries, {
        droppedCount: result.droppedCount,
        logWriteStatus: result.logWriteStatus,
      });
    } catch (error) {
      const message = formatError(error);
      setError(message);
    }
  },
  clear(): void {
    state.status = "idle";
    state.error = undefined;
    state.entries = [];
    state.fetchedAtUtc = undefined;
    state.droppedCount = 0;
    state.logWriteStatus = "ok";
    notify();
  },
};

export function selectAll(state: LogsState): LogEntry[] {
  return state.entries;
}

export function selectLevels(state: LogsState): LogLevel[] {
  return Array.from(new Set(state.entries.map((entry) => entry.level)));
}

export function selectCategories(state: LogsState): string[] {
  return Array.from(new Set(state.entries.map((entry) => entry.event)));
}

export function selectRange(state: LogsState): { min: number | null; max: number | null } {
  if (!state.entries.length) {
    return { min: null, max: null };
  }
  return {
    min: state.entries[state.entries.length - 1].tsEpochMs,
    max: state.entries[0].tsEpochMs,
  };
}

export function __setTailFetcherForTests(fetcher: TailFetcher): void {
  tailFetcher = fetcher;
}

export function __resetTailFetcherForTests(): void {
  tailFetcher = getTail;
}
