export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export type LogWriteStatus = "ok" | "io_error" | (string & {});

export interface RawLogLine {
  [k: string]: unknown;
}

export interface LogEntry {
  tsUtc: string;
  tsEpochMs: number;
  level: LogLevel;
  event: string;
  message?: string;
  household_id?: string;
  crash_id?: string;
  raw: RawLogLine;
}
