import type { LogEntry, LogLevel, RawLogLine } from "./logs.types";

type UnknownRecord = Record<string, unknown>;

const VALID_LEVELS = new Set<LogLevel>(["error", "warn", "info", "debug", "trace"]);

function toRecord(value: unknown): RawLogLine | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  return value as RawLogLine;
}

function parseJson(value: string): RawLogLine | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return toRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeLevel(value: unknown): LogLevel {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (VALID_LEVELS.has(normalized as LogLevel)) {
      return normalized as LogLevel;
    }
  }
  return "info";
}

function normalizeEvent(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "misc";
}

function normalizeMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function extractTimestamp(record: UnknownRecord): { ts: string; epoch: number } | null {
  const raw = record.ts ?? record.timestamp ?? record.time ?? record["tsUtc"]; // fallbacks just in case
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const epoch = Date.parse(trimmed);
  if (!Number.isFinite(epoch)) return null;
  return { ts: trimmed, epoch };
}

export function parseLogLine(
  input: string | Record<string, unknown>,
): LogEntry | null {
  const record =
    typeof input === "string" ? parseJson(input) : toRecord(input);
  if (!record) return null;

  const timestamp = extractTimestamp(record);
  if (!timestamp) return null;

  const level = normalizeLevel((record as UnknownRecord).level);
  const event = normalizeEvent((record as UnknownRecord).event);
  const message = normalizeMessage((record as UnknownRecord).message);
  const household_id = normalizeId((record as UnknownRecord).household_id);
  const crash_id = normalizeId((record as UnknownRecord).crash_id);

  const entry: LogEntry = {
    tsUtc: timestamp.ts,
    tsEpochMs: timestamp.epoch,
    level,
    event,
    message,
    household_id,
    crash_id,
    raw: record,
  };

  return entry;
}
