import { listFiles, toFilesListError } from "@features/files/api/listFiles";
import type { FileEntry } from "@features/files/model/fileEntry";
import type { RootKey } from "@lib/filesystem";

export type FilesListStatus = "loading" | "ready" | "empty" | "error";

export interface FilesListState {
  status: FilesListStatus;
  path: string;
  entries: FileEntry[];
  error?: string;
}

export interface FilesListController {
  subscribe(listener: (state: FilesListState) => void): () => void;
  load(directory?: string, rootOverride?: RootKey): Promise<void>;
  simulateEmpty(): void;
  simulateError(message?: string): void;
  getState(): FilesListState;
}

export function useFilesList(
  initialDirectory = ".",
  root?: RootKey,
): FilesListController {
  let state: FilesListState = {
    status: "loading",
    path: initialDirectory,
    entries: [],
  };
  let currentRoot = root;
  const listeners = new Set<(state: FilesListState) => void>();

  const emit = (): void => {
    for (const listener of listeners) listener(state);
  };

  const setState = (next: FilesListState): void => {
    state = next;
    emit();
  };

  const load = async (
    directory = state.path,
    rootOverride?: RootKey,
  ): Promise<void> => {
    if (rootOverride) currentRoot = rootOverride;
    setState({ status: "loading", path: directory, entries: [] });
    try {
      const entries = await listFiles({ directory, root: currentRoot });
      if (entries.length === 0) {
        setState({ status: "empty", path: directory, entries: [] });
      } else {
        setState({ status: "ready", path: directory, entries });
      }
    } catch (error) {
      setState({
        status: "error",
        path: directory,
        entries: [],
        error: toFilesListError(error),
      });
    }
  };

  const simulateEmpty = (): void => {
    setState({ status: "empty", path: state.path, entries: [] });
  };

  const simulateError = (message?: string): void => {
    setState({
      status: "error",
      path: state.path,
      entries: [],
      error: message ?? toFilesListError(new Error("Simulated failure")),
    });
  };

  const subscribe = (
    listener: (next: FilesListState) => void,
  ): (() => void) => {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  };

  // Kick the initial load without awaiting to prevent blocking callers.
  void load(initialDirectory, root);

  return {
    subscribe,
    load,
    simulateEmpty,
    simulateError,
    getState: () => state,
  };
}
