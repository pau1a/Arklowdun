import storage, { type StorageFlags } from "../../../storage";
import type { Settings } from "../model/Settings";

function cloneSettings(source: StorageFlags): Settings {
  return { ...source };
}

export async function fetchSettings(): Promise<Settings> {
  return cloneSettings(storage);
}

export type SettingsUpdate = Partial<Settings>;

export async function updateSettings(patch: SettingsUpdate): Promise<Settings> {
  Object.assign(storage, patch);
  return cloneSettings(storage);
}
