import { invoke } from "@tauri-apps/api/core";
import type { AppError } from "../bindings/AppError";

const FALLBACK_CODE = "APP/UNKNOWN";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizeContext(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key]) => typeof key === "string")
    .map(([key, val]) => [key, String(val)] as const);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function normalizeError(error: unknown): AppError {
  if (typeof error === "string") {
    return { code: FALLBACK_CODE, message: error };
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : FALLBACK_CODE;
    const message =
      typeof error.message === "string"
        ? error.message
        : typeof error.name === "string"
          ? error.name
          : JSON.stringify(error);

    const normalized: AppError = { code, message };

    const context = normalizeContext(error.context);
    if (context) normalized.context = context;

    if (error.cause) {
      normalized.cause = normalizeError(error.cause);
    } else if (typeof error.stack === "string" && !normalized.context?.stack) {
      normalized.context = {
        ...(normalized.context ?? {}),
        stack: error.stack,
      };
    }

    return normalized;
  }

  return { code: FALLBACK_CODE, message: String(error) };
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw normalizeError(err);
  }
}
