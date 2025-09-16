import type { AppError } from "../bindings/AppError";
import { normalizeError } from "../api/call";
import { log } from "../utils/logger";

export function showError(err: unknown) {
  const error: AppError = normalizeError(err);

  const container = document.querySelector("#errors");
  if (container) {
    if (error.crash_id) {
      container.textContent = `Something went wrong. Crash ID: ${error.crash_id}.`;
    } else {
      container.textContent = `${error.message} (${error.code})`;
    }
  }
  log.error("error", error);
}

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection", e.reason);
  showError(e.reason);
});
