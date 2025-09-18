import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export interface ImportEventPayload {
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ImportEvent<
  TPayload extends ImportEventPayload = ImportEventPayload,
> {
  event: string;
  id: number;
  payload: TPayload;
}

export type ImportEventHandler<
  TPayload extends ImportEventPayload = ImportEventPayload,
> = (event: ImportEvent<TPayload>) => void | Promise<void>;

export type ImportUnsubscribe = UnlistenFn;

const CHANNELS = {
  started: "import://started",
  progress: "import://progress",
  error: "import://error",
  done: "import://done",
} as const;

export type ImportChannel = (typeof CHANNELS)[keyof typeof CHANNELS];

async function listenToImportChannel<
  TPayload extends ImportEventPayload,
>(
  channel: ImportChannel,
  handler: ImportEventHandler<TPayload>,
): Promise<ImportUnsubscribe> {
  const callback: EventCallback<TPayload> = (event) =>
    handler({
      event: event.event,
      id: event.id,
      payload: event.payload,
    });

  return listen<TPayload>(channel, callback);
}

export type ImportStartedPayload = ImportEventPayload & {
  fields?: {
    logPath?: string;
    [key: string]: unknown;
  };
};

export type ImportProgressPayload = ImportEventPayload & {
  event?: string;
  step?: string;
  duration_ms?: number;
};

export type ImportDonePayload = ImportEventPayload & {
  duration_ms?: number;
  fields?: {
    imported?: number;
    skipped?: number;
    [key: string]: unknown;
  };
};

export type ImportErrorPayload = ImportEventPayload;

export function listenImportStarted(
  handler: ImportEventHandler<ImportStartedPayload>,
): Promise<ImportUnsubscribe> {
  return listenToImportChannel(CHANNELS.started, handler);
}

export function listenImportProgress(
  handler: ImportEventHandler<ImportProgressPayload>,
): Promise<ImportUnsubscribe> {
  return listenToImportChannel(CHANNELS.progress, handler);
}

export function listenImportError(
  handler: ImportEventHandler<ImportErrorPayload>,
): Promise<ImportUnsubscribe> {
  return listenToImportChannel(CHANNELS.error, handler);
}

export function listenImportDone(
  handler: ImportEventHandler<ImportDonePayload>,
): Promise<ImportUnsubscribe> {
  return listenToImportChannel(CHANNELS.done, handler);
}
