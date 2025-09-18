import type { AppError } from "../bindings/AppError";
import { normalizeError } from "../api/call";
import { log } from "../utils/logger";
import { toast } from "./Toast";

export function showError(err: unknown) {
  const error: AppError = normalizeError(err);

  const message = error.crash_id
    ? `Something went wrong. Crash ID: ${error.crash_id}.`
    : error.code
    ? `${error.message} (${error.code})`
    : error.message;
  toast.show({ kind: "error", message });
  log.error("error", error);
}

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection", e.reason);
  showError(e.reason);
});
