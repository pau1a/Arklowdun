import { createEmptyState } from "@ui/Empty";

export function createSettingsPlaceholder(): HTMLElement {
  return createEmptyState({
    title: "Settings",
    description: "Settings slice migration pending.",
  });
}
