import type { AppError } from "../bindings/AppError";
import { normalizeError } from "../db/call";
import { log } from "../utils/logger";

export function showError(err: unknown) {
  const error: AppError = normalizeError(err);

  const container = document.querySelector("#errors");
  if (container) {
    container.textContent = `${error.message} (${error.code})`;
  }
  log.error("error", error);
}

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection", e.reason);
  showError(e.reason);
});
