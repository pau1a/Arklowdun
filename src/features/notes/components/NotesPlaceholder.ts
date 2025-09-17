import { createEmptyState } from "@ui/Empty";

export function createNotesPlaceholder(): HTMLElement {
  return createEmptyState({
    title: "Notes",
    description: "Notes slice migration pending.",
  });
}
