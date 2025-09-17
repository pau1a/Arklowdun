const CLEANUP_KEY = Symbol.for("arklowdun:view:cleanups");

type CleanupMap = {
  [CLEANUP_KEY]?: Array<() => void>;
};

type WithCleanup = HTMLElement & CleanupMap;

export function runViewCleanups(host: HTMLElement): void {
  const store = host as WithCleanup;
  const cleanups = store[CLEANUP_KEY];
  if (!cleanups || cleanups.length === 0) {
    store[CLEANUP_KEY] = [];
    return;
  }
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (!fn) continue;
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }
  store[CLEANUP_KEY] = [];
}

export function registerViewCleanup(host: HTMLElement, fn: () => void): void {
  const store = host as WithCleanup;
  if (!store[CLEANUP_KEY]) {
    store[CLEANUP_KEY] = [];
  }
  store[CLEANUP_KEY]!.push(fn);
}
