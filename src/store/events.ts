export type FilesUpdatedPayload = { count: number; ts: number };
export type FilesLoadErrorPayload = { message: string; detail?: string };
export type EventsUpdatedPayload = {
  count: number;
  ts: number;
  window?: { start: number; end: number };
  truncated?: boolean;
};
export type NotesUpdatedPayload = { count: number; ts: number };
export type HouseholdChangedPayload = { householdId: string };
export type ErrorRaisedPayload = { id: string; message: string; code?: string };
export type AppReadyPayload = { ts: number };

export interface AppEventMap {
  "files:updated": FilesUpdatedPayload;
  "files:load-error": FilesLoadErrorPayload;
  "calendar:load-error": FilesLoadErrorPayload;
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
import { getSafe } from "@utils/object";

export function on<C extends AppEventChannel>(
  channel: C,
  listener: AppEventListener<C>,
): () => void {
  const existing = getSafe(listeners, channel);
  const bucket = existing ?? new Set<AppEventListener<AppEventChannel>>();
  if (!existing) {
    // eslint-disable-next-line security/detect-object-injection
    (listeners as Record<string, Set<AppEventListener<AppEventChannel>>>)[channel] =
      bucket as Set<AppEventListener<AppEventChannel>>;
  }
  bucket.add(listener as AppEventListener<AppEventChannel>);
  return () => {
    bucket.delete(listener as AppEventListener<AppEventChannel>);
    if (bucket.size === 0)
      // eslint-disable-next-line security/detect-object-injection
      delete (listeners as Record<string, unknown>)[channel];
  };
}

export function off<C extends AppEventChannel>(
  channel: C,
  listener: AppEventListener<C>,
): void {
  const bucket = getSafe(listeners, channel);
  bucket?.delete(listener as AppEventListener<AppEventChannel>);
  if (bucket && bucket.size === 0)
    // eslint-disable-next-line security/detect-object-injection
    delete (listeners as Record<string, unknown>)[channel];
}

export function emit<C extends AppEventChannel>(
  channel: C,
  payload: AppEventMap[C],
): void {
  const bucket = getSafe(listeners, channel) as
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
    const bucket = getSafe(listeners as any, channel) as
      | Set<AppEventListener<AppEventChannel>>
      | undefined;
    if (bucket) bucket.clear();
    // eslint-disable-next-line security/detect-object-injection
    delete (listeners as Record<string, unknown>)[channel];
  });
}
