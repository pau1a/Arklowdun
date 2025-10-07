import { getTail } from "./logs.api";
import { parseLogLine } from "./logs.parse";
import type { LogEntry, LogLevel } from "./logs.types";

export interface LogsState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  entries: LogEntry[];
  fetchedAtUtc?: string;
}

type Listener = (state: LogsState) => void;

type TailFetcher = () => Promise<(string | Record<string, unknown>)[]>;

const MAX_ENTRIES = 200;

const listeners = new Set<Listener>();

const state: LogsState = {
  status: "idle",
  entries: [],
};

let tailFetcher: TailFetcher = getTail;

function snapshot(): LogsState {
  return {
    status: state.status,
    error: state.error,
    entries: state.entries.slice(),
    fetchedAtUtc: state.fetchedAtUtc,
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
  state.entries = [];
  state.fetchedAtUtc = undefined;
  notify();
}

function setReady(entries: LogEntry[]): void {
  state.status = "ready";
  state.error = undefined;
  state.entries = entries;
  state.fetchedAtUtc = new Date().toISOString();
  notify();
}

function setError(message: string): void {
  state.status = "error";
  state.error = message;
  state.entries = [];
  state.fetchedAtUtc = undefined;
  notify();
}

function normalizeTail(
  lines: (string | Record<string, unknown>)[] | unknown,
): LogEntry[] {
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
      const lines = await tailFetcher();
      const entries = normalizeTail(lines);
      setReady(entries);
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
