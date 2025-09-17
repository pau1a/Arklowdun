import { createEmptyState } from "@ui/Empty";

export function createCalendarPlaceholder(): HTMLElement {
  return createEmptyState({
    title: "Calendar",
    description: "Calendar slice pending migration.",
  });
}
