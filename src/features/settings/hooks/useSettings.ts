import { fetchSettings } from "../api/settingsApi";
import type { Settings } from "../model/Settings";

export interface UseSettingsResult {
  data: Settings | null;
  error: unknown;
  isLoading: boolean;
}

export async function useSettings(): Promise<UseSettingsResult> {
  try {
    const data = await fetchSettings();
    return { data, error: null, isLoading: false };
  } catch (error) {
    return { data: null, error, isLoading: false };
  }
}
