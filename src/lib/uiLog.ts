export type UiLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type UiLogDetails = Record<string, unknown>;

type UiLogPayload = {
  level: UiLogLevel;
  cmd: string;
  details: UiLogDetails;
  household_id?: string;
  member_id?: string;
  duration_ms?: number;
};

type MaybeInvoker = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const HOUSEHOLD_KEYS = ["household_id", "householdId"] as const;
const MEMBER_KEYS = ["member_id", "memberId"] as const;
const DURATION_KEYS = ["duration_ms", "durationMs"] as const;

function coerceString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function coerceDuration(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return undefined;
}

function extractFirst<T extends readonly string[]>(
  details: UiLogDetails,
  keys: T,
  extractor: (value: unknown) => string | number | undefined,
): string | number | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(details, key)) {
      const next = extractor(details[key]);
      if (next !== undefined) {
        return next;
      }
    }
  }
  return undefined;
}

function buildPayload(level: UiLogLevel, cmd: string, details: UiLogDetails): UiLogPayload {
  const normalized: UiLogDetails = { ...details };
  const payload: UiLogPayload = { level, cmd, details: normalized };

  const household = extractFirst(normalized, HOUSEHOLD_KEYS, coerceString);
  if (typeof household === "string") {
    payload.household_id = household;
  }

  const member = extractFirst(normalized, MEMBER_KEYS, coerceString);
  if (typeof member === "string") {
    payload.member_id = member;
  }

  const duration = extractFirst(normalized, DURATION_KEYS, coerceDuration);
  if (typeof duration === "number") {
    payload.duration_ms = duration;
  }

  return payload;
}

function toJsonLine(payload: UiLogPayload): string {
  const envelope: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: payload.level,
    area: "family",
    cmd: payload.cmd,
    details: payload.details,
  };

  if (payload.household_id) envelope.household_id = payload.household_id;
  if (payload.member_id) envelope.member_id = payload.member_id;
  if (typeof payload.duration_ms === "number") envelope.duration_ms = payload.duration_ms;

  return JSON.stringify(envelope);
}

function emitThroughTauri(payload: UiLogPayload, fallbackLine: string): void {
  const fallback = () => {
    console.log(fallbackLine);
  };

  if (typeof window === "undefined") {
    fallback();
    return;
  }

  const anyWindow = window as typeof window & {
    __TAURI__?: { invoke?: MaybeInvoker };
  };

  const directInvoker = anyWindow.__TAURI__?.invoke;
  if (typeof directInvoker === "function") {
    void directInvoker.call(anyWindow.__TAURI__, "family_ui_log", payload).catch(fallback);
    return;
  }

  void import("@tauri-apps/api/core")
    .then((mod) => mod.invoke("family_ui_log", payload))
    .catch(fallback);
}

export function logUI(level: UiLogLevel, cmd: string, details: UiLogDetails = {}): void {
  const payload = buildPayload(level, cmd, details);
  const jsonLine = toJsonLine(payload);
  emitThroughTauri(payload, jsonLine);
}
