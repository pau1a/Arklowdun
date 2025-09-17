const CLEANUP_KEY = Symbol.for("arklowdun:view:cleanups");
import { getSafe } from "./object.ts";

type CleanupMap = {
  [CLEANUP_KEY]?: Array<() => void>;
};

type WithCleanup = HTMLElement & CleanupMap;

export function runViewCleanups(host: HTMLElement): void {
  const store = host as WithCleanup;
  const cleanups = getSafe(store as any, CLEANUP_KEY as any) as
    | Array<() => void>
    | undefined;
  if (!cleanups || cleanups.length === 0) {
    // eslint-disable-next-line security/detect-object-injection
    (store as any)[CLEANUP_KEY] = [];
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
  // eslint-disable-next-line security/detect-object-injection
  (store as any)[CLEANUP_KEY] = [];
}

export function registerViewCleanup(host: HTMLElement, fn: () => void): void {
  const store = host as WithCleanup;
  let arr = getSafe(store as any, CLEANUP_KEY as any) as Array<() => void> | undefined;
  if (!arr) {
    arr = [];
    // eslint-disable-next-line security/detect-object-injection
    (store as any)[CLEANUP_KEY] = arr;
  }
  arr.push(fn);
}
