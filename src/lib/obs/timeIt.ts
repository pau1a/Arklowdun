import type { UiLogLevel } from "@lib/uiLog";
import { logUI as defaultLogUI } from "@lib/uiLog";
import type { AppError } from "@bindings/AppError";
import { normalizeError as defaultNormalizeError } from "@lib/ipc/call";

export interface TimeItOptions<T> {
  successLevel?: UiLogLevel;
  errorLevel?: UiLogLevel;
  successFields?: (result: T) => Record<string, unknown>;
  errorFields?: (error: AppError) => Record<string, unknown>;
  classifySuccess?: (result: T) => boolean;
  softErrorFields?: (result: T) => Record<string, unknown>;
}

type TimeItDependencies = {
  now: () => number;
  logUI: typeof defaultLogUI;
  normalizeError: typeof defaultNormalizeError;
};

function systemNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

let currentDeps: TimeItDependencies = {
  now: systemNow,
  logUI: defaultLogUI,
  normalizeError: defaultNormalizeError,
};

function coerceAppError(error: unknown): AppError {
  if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
    return error as AppError;
  }
  return currentDeps.normalizeError(error);
}

export async function timeIt<T>(
  name: string,
  fn: () => Promise<T>,
  options: TimeItOptions<T> = {},
): Promise<T> {
  const start = currentDeps.now();
  try {
    const result = await fn();
    const ok = options.classifySuccess ? options.classifySuccess(result) : true;
    const duration = Math.max(0, Math.round(currentDeps.now() - start));
    const base: Record<string, unknown> = { name, duration_ms: duration, ok };
    if (options.successFields) {
      Object.assign(base, options.successFields(result));
    }
    if (!ok && options.softErrorFields) {
      Object.assign(base, options.softErrorFields(result));
    }
    const level: UiLogLevel = ok ? options.successLevel ?? "INFO" : options.errorLevel ?? "WARN";
    currentDeps.logUI(level, "perf.pets.timing", base);
    return result;
  } catch (error) {
    const normalized = coerceAppError(error);
    const duration = Math.max(0, Math.round(currentDeps.now() - start));
    const base: Record<string, unknown> = {
      name,
      duration_ms: duration,
      ok: false,
      code: normalized.code,
    };
    if (normalized.crash_id) {
      base.crash_id = normalized.crash_id;
    }
    if (options.errorFields) {
      Object.assign(base, options.errorFields(normalized));
    }
    currentDeps.logUI(options.errorLevel ?? "WARN", "perf.pets.timing", base);
    throw normalized;
  }
}

export const __testing = {
  setDependencies(overrides: Partial<TimeItDependencies>): void {
    currentDeps = {
      ...currentDeps,
      ...overrides,
    };
  },
  reset(): void {
    currentDeps = {
      now: systemNow,
      logUI: defaultLogUI,
      normalizeError: defaultNormalizeError,
    };
  },
};
