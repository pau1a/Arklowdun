import type { FsEntryLite as FsEntry } from "./types";
import type { Note } from "@features/notes";
import type { Event } from "../models";
import type { DbHealthReport } from "@bindings/DbHealthReport";
import type {
  FilesUpdatedPayload,
  EventsUpdatedPayload,
  NotesUpdatedPayload,
} from "./events";

export type AppPane =
  | "dashboard"
  | "primary"
  | "secondary"
  | "tasks"
  | "calendar"
  | "files"
  | "shopping"
  | "bills"
  | "insurance"
  | "property"
  | "vehicles"
  | "pets"
  | "family"
  | "inventory"
  | "budget"
  | "notes"
  | "settings"
  | "logs"
  | "manage";

export type AppError = {
  message: string;
  code?: string;
  id?: string;
  context?: Record<string, string>;
  crash_id?: string;
  cause?: unknown;
};

export type DbHealthPhase = "idle" | "pending" | "error";

export interface DbHealthState {
  phase: DbHealthPhase;
  report: DbHealthReport | null;
  lastUpdated: number | null;
  error: AppError | null;
}

export type FileSnapshot = {
  items: FsEntry[];
  ts: number;
  path: string;
  source?: string;
};

export type FilesScanStatus =
  | "idle"
  | "scanning"
  | "timeout"
  | "error"
  | "done";

export interface FilesErrorState {
  message: string;
  detail?: string;
}

export interface FilesState {
  snapshot: FileSnapshot | null;
  scanStatus: FilesScanStatus;
  scanStartedAt: number | null;
  scanDuration: number | null;
  error: FilesErrorState | null;
}

export type EventsSnapshot = {
  items: Event[];
  ts: number;
  window?: { start: number; end: number };
  source?: string;
  truncated?: boolean;
  limit?: number;
};

export type NotesSnapshot = {
  items: Note[];
  ts: number;
  source?: string;
  activeCategoryIds?: string[];
};

export interface AppState {
  app: {
    activePane: AppPane;
    isAppReady: boolean;
    errors: AppError[];
  };
  files: FilesState;
  events: {
    snapshot: EventsSnapshot | null;
  };
  notes: {
    snapshot: NotesSnapshot | null;
  };
  db: {
    health: DbHealthState;
  };
}

const initialState: AppState = {
  app: {
    activePane: "dashboard",
    isAppReady: false,
    errors: [],
  },
  files: {
    snapshot: null,
    scanStatus: "idle",
    scanStartedAt: null,
    scanDuration: null,
    error: null,
  },
  events: { snapshot: null },
  notes: { snapshot: null },
  db: {
    health: {
      phase: "idle",
      report: null,
      lastUpdated: null,
      error: null,
    },
  },
};

let state: AppState = initialState;

type Selector<T> = (state: AppState) => T;

interface SubscriptionEntry<T> {
  selector: Selector<T>;
  listener: (value: T) => void;
  lastValue: T;
}

const subscriptions = new Set<SubscriptionEntry<unknown>>();

function cloneEntries(entries: FsEntry[]): FsEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function cloneEvents(entries: Event[]): Event[] {
  return entries.map((entry) => ({ ...entry }));
}

function cloneNotes(entries: Note[]): Note[] {
  return entries.map((entry) => ({ ...entry }));
}

export function getState(): AppState {
  return state;
}

export function setState(updater: (prev: AppState) => AppState): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  subscriptions.forEach((entry) => {
    const nextValue = entry.selector(state) as unknown;
    if (!Object.is(nextValue, entry.lastValue)) {
      entry.lastValue = nextValue;
      entry.listener(nextValue as never);
    }
  });
}

export function subscribe<T>(
  selector: Selector<T>,
  listener: (value: T) => void,
): () => void {
  const entry: SubscriptionEntry<T> = {
    selector,
    listener,
    lastValue: selector(state),
  };
  subscriptions.add(entry as SubscriptionEntry<unknown>);
  listener(entry.lastValue);
  return () => {
    subscriptions.delete(entry as SubscriptionEntry<unknown>);
  };
}

function updateAppSlice(partial: Partial<AppState["app"]>): void {
  setState((prev) => {
    const next = { ...prev.app, ...partial };
    if (
      next.activePane === prev.app.activePane &&
      next.isAppReady === prev.app.isAppReady &&
      next.errors === prev.app.errors
    ) {
      return prev;
    }
    return { ...prev, app: next };
  });
}

function setSnapshot<S>(current: S | null, next: S | null): S | null {
  if (current === null && next === null) return current;
  if (current === null || next === null) return next;
  const sameKeys = Object.keys(next as object).every((key) =>
    Object.is(getSafe(next as any, key), getSafe(current as any, key)),
  );
  return sameKeys ? current : next;
}

export const selectors = {
  app: {
    activePane: (s: AppState) => s.app.activePane,
    isAppReady: (s: AppState) => s.app.isAppReady,
    errors: (s: AppState) => s.app.errors,
  },
  files: {
    snapshot: (s: AppState) => s.files.snapshot,
    items: (s: AppState) => s.files.snapshot?.items ?? [],
    ts: (s: AppState) => s.files.snapshot?.ts ?? 0,
    path: (s: AppState) => s.files.snapshot?.path ?? null,
    scanStatus: (s: AppState) => s.files.scanStatus,
    scanStartedAt: (s: AppState) => s.files.scanStartedAt,
    scanDuration: (s: AppState) => s.files.scanDuration,
    error: (s: AppState) => s.files.error,
  },
  events: {
    snapshot: (s: AppState) => s.events.snapshot,
    items: (s: AppState) => s.events.snapshot?.items ?? [],
    window: (s: AppState) => s.events.snapshot?.window ?? null,
    ts: (s: AppState) => s.events.snapshot?.ts ?? 0,
    truncated: (s: AppState) => s.events.snapshot?.truncated ?? false,
  },
  notes: {
    snapshot: (s: AppState) => s.notes.snapshot,
    items: (s: AppState) => s.notes.snapshot?.items ?? [],
    ts: (s: AppState) => s.notes.snapshot?.ts ?? 0,
  },
  db: {
    health: (s: AppState) => s.db.health,
    healthReport: (s: AppState) => s.db.health.report,
    healthPhase: (s: AppState) => s.db.health.phase,
    healthError: (s: AppState) => s.db.health.error,
    healthLastUpdated: (s: AppState) => s.db.health.lastUpdated,
  },
};

function cloneFileSnapshot(snapshot: FileSnapshot | null): FileSnapshot | null {
  if (!snapshot) return null;
  return { ...snapshot, items: cloneEntries(snapshot.items) };
}

function withFilesState(partial: Partial<FilesState>): AppState {
  const nextSnapshot =
    partial.snapshot !== undefined
      ? setSnapshot(state.files.snapshot, cloneFileSnapshot(partial.snapshot))
      : state.files.snapshot;
  return {
    ...state,
    files: {
      ...state.files,
      ...partial,
      snapshot: nextSnapshot,
    },
  };
}

function withEventsSnapshot(snapshot: EventsSnapshot | null): AppState {
  const cloned = snapshot
    ? { ...snapshot, items: cloneEvents(snapshot.items) }
    : null;
  return {
    ...state,
    events: {
      snapshot: setSnapshot(state.events.snapshot, cloned),
    },
  };
}

function withNotesSnapshot(snapshot: NotesSnapshot | null): AppState {
  const cloned = snapshot
    ? {
        ...snapshot,
        items: cloneNotes(snapshot.items),
        activeCategoryIds: snapshot.activeCategoryIds
          ? [...snapshot.activeCategoryIds]
          : undefined,
      }
    : null;
  return {
    ...state,
    notes: {
      snapshot: setSnapshot(state.notes.snapshot, cloned),
    },
  };
}

function setDbHealthState(
  updater: (current: DbHealthState) => DbHealthState,
): void {
  setState((prev) => {
    const next = updater(prev.db.health);
    const current = prev.db.health;
    if (
      next === current ||
      (next.phase === current.phase &&
        next.report === current.report &&
        next.lastUpdated === current.lastUpdated &&
        next.error === current.error)
    ) {
      return prev;
    }
    return {
      ...prev,
      db: {
        ...prev.db,
        health: next,
      },
    };
  });
}

export const actions = {
  setActivePane(pane: AppPane): void {
    updateAppSlice({ activePane: pane, isAppReady: true });
  },
  pushError(error: AppError): void {
    setState((prev) => ({
      ...prev,
      app: {
        ...prev.app,
        errors: [...prev.app.errors, error],
      },
    }));
  },
  clearError(id: string): void {
    setState((prev) => {
      const nextErrors = prev.app.errors.filter((err) => err.id !== id);
      if (nextErrors === prev.app.errors) return prev;
      return {
        ...prev,
        app: {
          ...prev.app,
          errors: nextErrors,
        },
      };
    });
  },
  files: {
    beginScan(): void {
      const startedAt = Date.now();
      setState(() =>
        withFilesState({
          scanStatus: "scanning",
          scanStartedAt: startedAt,
          scanDuration: null,
          error: null,
        }),
      );
    },
    updateSnapshot(snapshot: FileSnapshot | null): FilesUpdatedPayload {
      const completedAt = Date.now();
      const startedAt = state.files.scanStartedAt;
      setState(() =>
        withFilesState({
          snapshot,
          scanStatus: snapshot ? "done" : "idle",
          scanDuration:
            typeof startedAt === "number" ? completedAt - startedAt : null,
          scanStartedAt: startedAt,
          error: null,
        }),
      );
      const count = snapshot?.items.length ?? 0;
      const ts = snapshot?.ts ?? completedAt;
      return { count, ts };
    },
    failScan(error: FilesErrorState): void {
      const completedAt = Date.now();
      const startedAt = state.files.scanStartedAt;
      setState(() =>
        withFilesState({
          scanStatus: "error",
          scanDuration:
            typeof startedAt === "number" ? completedAt - startedAt : null,
          error,
        }),
      );
    },
    timeoutScan(): void {
      const completedAt = Date.now();
      const startedAt = state.files.scanStartedAt;
      setState(() =>
        withFilesState({
          scanStatus: "timeout",
          scanDuration:
            typeof startedAt === "number" ? completedAt - startedAt : null,
        }),
      );
    },
    resetScan(): void {
      setState(() =>
        withFilesState({
          scanStatus: "idle",
          scanStartedAt: null,
          scanDuration: null,
          error: null,
        }),
      );
    },
  },
  events: {
    updateSnapshot(snapshot: EventsSnapshot | null): EventsUpdatedPayload {
      setState(() => withEventsSnapshot(snapshot));
      const count = snapshot?.items.length ?? 0;
      const ts = snapshot?.ts ?? Date.now();
      const truncated = snapshot?.truncated ?? false;
      return { count, ts, window: snapshot?.window, truncated, limit: snapshot?.limit };
    },
  },
  notes: {
    updateSnapshot(snapshot: NotesSnapshot | null): NotesUpdatedPayload {
      setState(() => withNotesSnapshot(snapshot));
      const count = snapshot?.items.length ?? 0;
      const ts = snapshot?.ts ?? Date.now();
      const activeCategoryIds = snapshot?.activeCategoryIds ?? [];
      return { count, ts, activeCategoryIds };
    },
  },
  db: {
    health: {
      beginCheck(): void {
        setDbHealthState((current) => {
          if (current.phase === "pending" && current.error === null) {
            return current;
          }
          return { ...current, phase: "pending", error: null };
        });
      },
      receive(report: DbHealthReport): void {
        setDbHealthState(() => ({
          phase: "idle",
          report,
          lastUpdated: Date.now(),
          error: null,
        }));
      },
      fail(error: AppError): void {
        setDbHealthState((current) => ({
          ...current,
          phase: "error",
          error,
        }));
      },
      clearError(): void {
        setDbHealthState((current) => {
          if (!current.error) return current;
          return { ...current, error: null };
        });
      },
    },
  },
};

/** @internal test hook */
export function __resetStore(): void {
  state = initialState;
  subscriptions.clear();
}
import { getSafe } from "@utils/object";
