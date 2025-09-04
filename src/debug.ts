// src/debug.ts
import { invoke as realInvoke } from "@tauri-apps/api/core";

// Loud global JS errors
window.addEventListener("error", (e) => {
  const msg = `JS Error: ${e.message}\n${e.error?.stack ?? ""}`;
  console.error(msg);
  alert(msg); // make it impossible to miss
});

window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  const reason: any = e.reason;
  const msg = `Unhandled Promise Rejection:\n${
    typeof reason === "object" ? JSON.stringify(reason, null, 2) : String(reason)
  }`;
  console.error(msg);
  alert(msg);
});

// Wrap tauri invoke so backend failures are visible
export async function invoke<T = unknown>(cmd: string, args?: Record<string, any>): Promise<T> {
  try {
    return await realInvoke<T>(cmd, args);
  } catch (err: any) {
    const detail =
      typeof err === "object" ? JSON.stringify(err, null, 2) : String(err);
    const msg = `invoke("${cmd}") failed:\n${detail}\nargs: ${JSON.stringify(args ?? {}, null, 2)}`;
    console.error(msg);
    alert(msg);
    throw err; // keep normal behavior after shouting
  }
}
