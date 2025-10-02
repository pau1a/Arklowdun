import { listen } from "@tauri-apps/api/event";
import {
  getActiveHouseholdId,
  setActiveHouseholdId,
  type SetActiveHouseholdResult,
} from "../api/households";
import { emit } from "../store/events";
import { log } from "../utils/logger";

let current: string | null = null;
let listenerReady: Promise<void> | null = null;
let dispose: (() => void) | null = null;

async function ensureNativeListener(): Promise<void> {
  if (listenerReady) return listenerReady;
  listenerReady = listen<{ id: string }>("household:changed", ({ payload }) => {
    current = payload.id;
    emit("household:changed", { householdId: payload.id });
  })
    .then((unlisten) => {
      dispose = () => {
        unlisten();
        dispose = null;
        listenerReady = null;
      };
    })
    .catch((error) => {
      log.warn("householdStore:listen_failed", error);
      listenerReady = null;
    })
    .then(() => {
      /* no-op */
    });
  return listenerReady ?? Promise.resolve();
}

void ensureNativeListener();

export async function ensureActiveHousehold(): Promise<string> {
  await ensureNativeListener();
  if (current) return current;
  current = await getActiveHouseholdId();
  return current;
}

export async function forceSetActiveHousehold(id: string): Promise<SetActiveHouseholdResult> {
  await ensureNativeListener();
  const result = await setActiveHouseholdId(id);
  if (result.ok) {
    current = id;
  }
  return result;
}

export function currentActiveHousehold(): string | null {
  return current;
}

export function __resetHouseholdStore(): void {
  current = null;
  if (dispose) {
    dispose();
  }
  dispose = null;
  listenerReady = null;
}
