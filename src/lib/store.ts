import { log } from "@utils/logger";

let storeLoader: Promise<import("@tauri-apps/plugin-store").Store | null> | null = null;
let storeUnavailable = false;

const STORE_PATH = "window-state.json";

export type AmbientMode = "off" | "eco" | "full";
export type RotationMode = "off" | "weekly" | "monthly" | "manual";

export interface WindowStateSchema {
  installId: string;
  blobRotation: RotationMode;
  blobWeekKey: string;
  blobSeed: number;
  blobLastGeneratedAt: string;
  ambientMode: AmbientMode;
}

const volatileState: Partial<WindowStateSchema> = {};

const DEFAULT_AMBIENT_MODE: AmbientMode = "eco";
const DEFAULT_ROTATION_MODE: RotationMode = "weekly";

const storeEvents = new EventTarget();

async function loadStore(): Promise<import("@tauri-apps/plugin-store").Store | null> {
  if (storeUnavailable || typeof window === "undefined") {
    return null;
  }
  if (!storeLoader) {
    storeLoader = import("@tauri-apps/plugin-store")
      .then(({ Store }) => Store.load(STORE_PATH))
      .then((store) => store)
      .catch((error) => {
        storeUnavailable = true;
        log.warn("store: plugin unavailable", error);
        return null;
      });
  }
  return storeLoader;
}

async function readValue<K extends keyof WindowStateSchema>(
  key: K,
): Promise<WindowStateSchema[K] | undefined> {
  const store = await loadStore();
  if (store) {
    try {
      const value = await store.get<WindowStateSchema[K] | undefined>(key);
      if (value !== undefined && value !== null) {
        return value;
      }
    } catch (error) {
      log.warn("store: read failed", { key, error });
    }
  }
  return volatileState[key];
}

async function persistValue<K extends keyof WindowStateSchema>(
  key: K,
  value: WindowStateSchema[K],
): Promise<void> {
  volatileState[key] = value;
  const store = await loadStore();
  if (!store) return;
  try {
    await store.set(key, value);
    await store.save();
  } catch (error) {
    log.warn("store: persist failed", { key, error });
  }
}

function emitAmbientModeChange(mode: AmbientMode): void {
  storeEvents.dispatchEvent(new CustomEvent<AmbientMode>("ambient-mode", { detail: mode }));
}

function emitRotationModeChange(mode: RotationMode): void {
  storeEvents.dispatchEvent(new CustomEvent<RotationMode>("rotation-mode", { detail: mode }));
}

export async function getAmbientMode(): Promise<AmbientMode> {
  const value = await readValue("ambientMode");
  return value === "off" || value === "eco" || value === "full"
    ? value
    : DEFAULT_AMBIENT_MODE;
}

export async function setAmbientMode(mode: AmbientMode): Promise<void> {
  await persistValue("ambientMode", mode);
  emitAmbientModeChange(mode);
}

export async function getRotationMode(): Promise<RotationMode> {
  const value = await readValue("blobRotation");
  return value === "off" || value === "weekly" || value === "monthly" || value === "manual"
    ? value
    : DEFAULT_ROTATION_MODE;
}

export async function setRotationMode(mode: RotationMode): Promise<void> {
  await persistValue("blobRotation", mode);
  emitRotationModeChange(mode);
}

export async function getStoreValue<K extends keyof WindowStateSchema>(
  key: K,
): Promise<WindowStateSchema[K] | undefined> {
  return readValue(key);
}

export async function setStoreValue<K extends keyof WindowStateSchema>(
  key: K,
  value: WindowStateSchema[K],
): Promise<void> {
  await persistValue(key, value);
}

export function onAmbientModeChange(listener: (mode: AmbientMode) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<AmbientMode>).detail);
  };
  storeEvents.addEventListener("ambient-mode", handler);
  return () => {
    storeEvents.removeEventListener("ambient-mode", handler);
  };
}

export function onRotationModeChange(listener: (mode: RotationMode) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<RotationMode>).detail);
  };
  storeEvents.addEventListener("rotation-mode", handler);
  return () => {
    storeEvents.removeEventListener("rotation-mode", handler);
  };
}

export function __resetStoreForTests(): void {
  Object.keys(volatileState).forEach((key) => {
    delete (volatileState as Record<string, unknown>)[key];
  });
  storeLoader = null;
  storeUnavailable = false;
}

export { DEFAULT_AMBIENT_MODE, DEFAULT_ROTATION_MODE };
