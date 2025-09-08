import { invoke } from "@tauri-apps/api/core";

export type ArkError = { code: string; message: string; details?: unknown };

export function toArkError(e: unknown): ArkError {
  // Tauri error shapes are inconsistent: strings, { message }, { code, message, data }, etc.
  if (typeof e === "string") return { code: "UNKNOWN", message: e };
  if (e && typeof e === "object") {
    const any = e as any;
    const code = any.code || any.name || "UNKNOWN";
    const message = any.message || String(e);
    const details = any.data ?? any.details ?? any.stack ?? undefined;
    return { code: String(code), message: String(message), details };
  }
  return { code: "UNKNOWN", message: String(e) };
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toArkError(e);
  }
}
