import { listen } from "@tauri-apps/api/event";
import {
  createHousehold as apiCreateHousehold,
  deleteHousehold as apiDeleteHousehold,
  getActiveHouseholdId,
  listHouseholds as apiListHouseholds,
  restoreHousehold as apiRestoreHousehold,
  setActiveHouseholdId,
  updateHousehold as apiUpdateHousehold,
  type DeleteHouseholdResponse,
  type HouseholdRecord,
  type SetActiveHouseholdResult,
  type UpdateHouseholdInput,
} from "../api/households";
import { emit } from "../store/events";
import { log } from "../utils/logger";

export interface HouseholdStoreState {
  households: HouseholdRecord[];
  activeId: string | null;
  showDeleted: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

type Selector<T> = (state: HouseholdStoreState) => T;

interface InternalSubscriptionEntry {
  selector: Selector<unknown>;
  listener: (value: unknown) => void;
  lastValue: unknown;
}

const INITIAL_STATE: HouseholdStoreState = {
  households: [],
  activeId: null,
  showDeleted: false,
  loading: false,
  loaded: false,
  error: null,
};

let state: HouseholdStoreState = INITIAL_STATE;
let listenerReady: Promise<void> | null = null;
let dispose: (() => void) | null = null;
let refreshPromise: Promise<HouseholdRecord[]> | null = null;

const subscriptions = new Set<InternalSubscriptionEntry>();

function notifySubscribers(): void {
  subscriptions.forEach((entry) => {
    const nextValue = entry.selector(state);
    if (!Object.is(nextValue, entry.lastValue)) {
      entry.lastValue = nextValue;
      entry.listener(nextValue);
    }
  });
}

function setState(
  updater: (prev: HouseholdStoreState) => HouseholdStoreState,
): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  notifySubscribers();
}

function updateState(patch: Partial<HouseholdStoreState>): void {
  setState((prev) => {
    const next = { ...prev, ...patch };
    if (
      next.households === prev.households &&
      next.activeId === prev.activeId &&
      next.showDeleted === prev.showDeleted &&
      next.loading === prev.loading &&
      next.loaded === prev.loaded &&
      next.error === prev.error
    ) {
      return prev;
    }
    return next;
  });
}

function setActiveId(id: string, emitChange = true): void {
  let changed = false;
  setState((prev) => {
    if (prev.activeId === id) {
      return prev;
    }
    changed = true;
    return { ...prev, activeId: id };
  });
  if (changed && emitChange) {
    emit("household:changed", { householdId: id });
  }
}

async function ensureNativeListener(): Promise<void> {
  if (listenerReady) return listenerReady;
  listenerReady = listen<{ id: string }>("household:changed", ({ payload }) => {
    if (typeof payload?.id === "string") {
      setActiveId(payload.id);
    }
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

export function getState(): HouseholdStoreState {
  return state;
}

export function subscribe<T>(
  selector: Selector<T>,
  listener: (value: T) => void,
): () => void {
  const entry: InternalSubscriptionEntry = {
    selector: selector as Selector<unknown>,
    listener: listener as (value: unknown) => void,
    lastValue: selector(state),
  };
  subscriptions.add(entry);
  listener(entry.lastValue as T);
  return () => {
    subscriptions.delete(entry);
  };
}

export const selectors = {
  allHouseholds: (s: HouseholdStoreState): HouseholdRecord[] =>
    s.showDeleted
      ? [...s.households]
      : s.households.filter((household) => household.deletedAt === null),
  activeHousehold: (s: HouseholdStoreState): HouseholdRecord | null =>
    s.households.find((household) => household.id === s.activeId) ?? null,
  deletedHouseholds: (s: HouseholdStoreState): HouseholdRecord[] =>
    s.showDeleted
      ? s.households.filter((household) => household.deletedAt !== null)
      : [],
};

export function setShowDeleted(show: boolean): void {
  updateState({ showDeleted: show });
}

export async function ensureActiveHousehold(): Promise<string> {
  await ensureNativeListener();
  if (state.activeId) return state.activeId;
  const id = await getActiveHouseholdId();
  if (typeof id === "string") {
    setActiveId(id, false);
    return id;
  }
  throw new Error("Active household id unavailable");
}

export function currentActiveHousehold(): string | null {
  return state.activeId;
}

export async function forceSetActiveHousehold(
  id: string,
): Promise<SetActiveHouseholdResult> {
  await ensureNativeListener();
  const result = await setActiveHouseholdId(id);
  if (result.ok) {
    setActiveId(id);
  }
  return result;
}

export async function refreshHouseholds(): Promise<HouseholdRecord[]> {
  if (refreshPromise) return refreshPromise;
  const promise = (async () => {
    updateState({ loading: true, error: null });
    try {
      const records = await apiListHouseholds(true);
      setState((prev) => ({
        ...prev,
        households: records,
        loading: false,
        loaded: true,
        error: null,
      }));
      return records;
    } catch (error) {
      log.warn("householdStore:refresh_failed", error);
      updateState({ loading: false, error: "Unable to load households." });
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  refreshPromise = promise;
  return promise;
}

export async function ensureHouseholdsLoaded(): Promise<void> {
  if (state.loaded || state.loading) {
    return;
  }
  await refreshHouseholds();
}

export async function createHousehold(
  name: string,
  color: string | null,
): Promise<HouseholdRecord> {
  const record = await apiCreateHousehold(name, color);
  setState((prev) => ({
    ...prev,
    households: [...prev.households, record],
  }));
  await refreshHouseholds();
  return record;
}

export async function updateHousehold(
  id: string,
  input: UpdateHouseholdInput,
): Promise<HouseholdRecord> {
  const record = await apiUpdateHousehold(id, input);
  setState((prev) => ({
    ...prev,
    households: prev.households.map((household) =>
      household.id === record.id ? record : household,
    ),
  }));
  await refreshHouseholds();
  return record;
}

export async function deleteHousehold(
  id: string,
): Promise<DeleteHouseholdResponse> {
  const response = await apiDeleteHousehold(id);
  const deletedAt = Date.now();
  setState((prev) => ({
    ...prev,
    households: prev.households.map((household) =>
      household.id === id
        ? { ...household, deletedAt, updatedAt: deletedAt }
        : household,
    ),
  }));
  if (response.fallbackId) {
    setActiveId(response.fallbackId);
  }
  await refreshHouseholds();
  return response;
}

export async function restoreHousehold(
  id: string,
): Promise<HouseholdRecord> {
  const record = await apiRestoreHousehold(id);
  setState((prev) => ({
    ...prev,
    households: prev.households.map((household) =>
      household.id === record.id ? record : household,
    ),
  }));
  await refreshHouseholds();
  return record;
}

export function __resetHouseholdStore(): void {
  state = { ...INITIAL_STATE };
  refreshPromise = null;
  subscriptions.clear();
  if (dispose) {
    dispose();
  }
  dispose = null;
  listenerReady = null;
}
