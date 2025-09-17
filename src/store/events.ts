export type FilesUpdatedPayload = { count: number; ts: number };
export type EventsUpdatedPayload = {
  count: number;
  ts: number;
  window?: { start: number; end: number };
};
export type NotesUpdatedPayload = { count: number; ts: number };
export type HouseholdChangedPayload = { householdId: string };
export type ErrorRaisedPayload = { id: string; message: string; code?: string };
export type AppReadyPayload = { ts: number };

export interface AppEventMap {
  "files:updated": FilesUpdatedPayload;
  "events:updated": EventsUpdatedPayload;
  "notes:updated": NotesUpdatedPayload;
  "household:changed": HouseholdChangedPayload;
  "error:raised": ErrorRaisedPayload;
  "app:ready": AppReadyPayload;
}

export type AppEventChannel = keyof AppEventMap;
export type AppEventListener<C extends AppEventChannel> = (
  payload: AppEventMap[C],
) => void;

const listeners: Partial<
  Record<AppEventChannel, Set<AppEventListener<AppEventChannel>>>
> = {};

export function on<C extends AppEventChannel>(
  channel: C,
  listener: AppEventListener<C>,
): () => void {
  const bucket = (listeners[channel] ??= new Set());
  bucket.add(listener as AppEventListener<AppEventChannel>);
  return () => {
    bucket.delete(listener as AppEventListener<AppEventChannel>);
    if (bucket.size === 0) delete listeners[channel];
  };
}

export function off<C extends AppEventChannel>(
  channel: C,
  listener: AppEventListener<C>,
): void {
  const bucket = listeners[channel];
  bucket?.delete(listener as AppEventListener<AppEventChannel>);
  if (bucket && bucket.size === 0) delete listeners[channel];
}

export function emit<C extends AppEventChannel>(
  channel: C,
  payload: AppEventMap[C],
): void {
  const bucket = listeners[channel] as
    | Set<AppEventListener<AppEventChannel>>
    | undefined;
  if (!bucket || bucket.size === 0) return;
  for (const listener of Array.from(bucket)) {
    try {
      (listener as AppEventListener<C>)(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

/** @internal test hook */
export function __resetListeners(): void {
  (Object.keys(listeners) as AppEventChannel[]).forEach((channel) => {
    const bucket = listeners[channel];
    if (bucket) bucket.clear();
    delete listeners[channel];
  });
}
