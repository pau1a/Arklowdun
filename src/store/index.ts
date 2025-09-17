import type { FsEntry } from "@lib/ipc/files/safe-fs";
import type { Event, Note } from "../models";
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
  | "manage";

export type AppError = { id: string; message: string; code?: string };

export type FileSnapshot = {
  items: FsEntry[];
  ts: number;
  path: string;
  source?: string;
};

export type EventsSnapshot = {
  items: Event[];
  ts: number;
  window?: { start: number; end: number };
  source?: string;
};

export type NotesSnapshot = {
  items: Note[];
  ts: number;
  source?: string;
};

export interface AppState {
  app: {
    activePane: AppPane;
    isAppReady: boolean;
    errors: AppError[];
  };
  files: {
    snapshot: FileSnapshot | null;
  };
  events: {
    snapshot: EventsSnapshot | null;
  };
  notes: {
    snapshot: NotesSnapshot | null;
  };
}

const initialState: AppState = {
  app: {
    activePane: "dashboard",
    isAppReady: false,
    errors: [],
  },
  files: { snapshot: null },
  events: { snapshot: null },
  notes: { snapshot: null },
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
    Object.is((next as any)[key], (current as any)[key]),
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
  },
  events: {
    snapshot: (s: AppState) => s.events.snapshot,
    items: (s: AppState) => s.events.snapshot?.items ?? [],
    window: (s: AppState) => s.events.snapshot?.window ?? null,
    ts: (s: AppState) => s.events.snapshot?.ts ?? 0,
  },
  notes: {
    snapshot: (s: AppState) => s.notes.snapshot,
    items: (s: AppState) => s.notes.snapshot?.items ?? [],
    ts: (s: AppState) => s.notes.snapshot?.ts ?? 0,
  },
};

function withFilesSnapshot(snapshot: FileSnapshot | null): AppState {
  const cloned = snapshot
    ? { ...snapshot, items: cloneEntries(snapshot.items) }
    : null;
  return {
    ...state,
    files: {
      snapshot: setSnapshot(state.files.snapshot, cloned),
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
    ? { ...snapshot, items: cloneNotes(snapshot.items) }
    : null;
  return {
    ...state,
    notes: {
      snapshot: setSnapshot(state.notes.snapshot, cloned),
    },
  };
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
    updateSnapshot(snapshot: FileSnapshot | null): FilesUpdatedPayload {
      setState(() => withFilesSnapshot(snapshot));
      const count = snapshot?.items.length ?? 0;
      const ts = snapshot?.ts ?? Date.now();
      return { count, ts };
    },
  },
  events: {
    updateSnapshot(snapshot: EventsSnapshot | null): EventsUpdatedPayload {
      setState(() => withEventsSnapshot(snapshot));
      const count = snapshot?.items.length ?? 0;
      const ts = snapshot?.ts ?? Date.now();
      return { count, ts, window: snapshot?.window };
    },
  },
  notes: {
    updateSnapshot(snapshot: NotesSnapshot | null): NotesUpdatedPayload {
      setState(() => withNotesSnapshot(snapshot));
      const count = snapshot?.items.length ?? 0;
      const ts = snapshot?.ts ?? Date.now();
      return { count, ts };
    },
  },
};

/** @internal test hook */
export function __resetStore(): void {
  state = initialState;
  subscriptions.clear();
}
