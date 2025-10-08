import type { LogWriteStatus } from "@features/logs/logs.types";

export interface LogsStatusBanner {
  update(meta: { droppedCount: number; logWriteStatus: LogWriteStatus }): void;
  reset(): void;
}

function showMessage(element: HTMLElement, message: string | null): void {
  if (message) {
    element.textContent = message;
    element.hidden = false;
  } else {
    element.textContent = "";
    element.hidden = true;
  }
}

export function createLogsStatusBanner(element: HTMLElement): LogsStatusBanner {
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.hidden = true;

  return {
    update({ droppedCount, logWriteStatus }) {
      if (droppedCount > 0) {
        showMessage(
          element,
          "⚠ Some log entries may have been skipped (buffer full).",
        );
        return;
      }
      if (logWriteStatus !== "ok") {
        showMessage(
          element,
          "⚠ Logging paused – disk write issue detected.",
        );
        return;
      }
      showMessage(element, null);
    },
    reset() {
      showMessage(element, null);
    },
  };
}
