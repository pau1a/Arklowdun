import type { ArkError } from "../db/call";
import { toArkError } from "../db/call";
import { log } from "../utils/logger";

export function showError(err: unknown) {
  const e: ArkError =
    typeof err === "object" && err && "code" in (err as any) && "message" in (err as any)
      ? (err as ArkError)
      : toArkError(err);

  const container = document.querySelector("#errors");
  if (container) {
    container.textContent = `${e.message} (${e.code})`;
  }
  log.error("error", e);
}

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection", e.reason);
  showError(e.reason);
});
