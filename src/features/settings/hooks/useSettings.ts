import type { SettingsModelPlaceholder } from "@features/settings/model/types";

export function useSettingsSnapshot(): SettingsModelPlaceholder {
  return { placeholder: true };
}
