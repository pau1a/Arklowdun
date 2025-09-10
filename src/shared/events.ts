export type AppEvent = 'householdChanged' | 'searchInvalidated';

const listeners = new Map<AppEvent, Set<() => void>>();

export function on(event: AppEvent, fn: () => void): void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
}

export function off(event: AppEvent, fn: () => void): void {
  listeners.get(event)?.delete(fn);
}

export function emit(event: AppEvent): void {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  });
}
