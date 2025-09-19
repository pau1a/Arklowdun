import { call } from "@lib/ipc/call";

export interface BackfillSummary {
  household_id: string;
  total_scanned: number;
  total_updated: number;
  total_skipped: number;
  elapsed_ms: number;
  status: "completed" | "cancelled" | "failed";
}

export interface BackfillCheckpointStatus {
  processed: number;
  updated: number;
  skipped: number;
  total: number;
  remaining: number;
}

export interface BackfillStatusReport {
  running: string | null;
  checkpoint: BackfillCheckpointStatus | null;
  pending: number;
}

export interface StartBackfillOptions {
  householdId: string;
  dryRun?: boolean;
  chunkSize?: number;
  defaultTimezone?: string;
  resume?: boolean;
  progressIntervalMs?: number;
}

export function startBackfill(options: StartBackfillOptions): Promise<BackfillSummary> {
  const {
    householdId,
    dryRun = false,
    chunkSize,
    defaultTimezone,
    resume = false,
    progressIntervalMs,
  } = options;

  const args: Record<string, unknown> = {
    householdId: householdId,
    dryRun: dryRun,
    resetCheckpoint: !resume,
  };

  if (typeof chunkSize === "number") {
    args.chunkSize = chunkSize;
  }
  if (typeof defaultTimezone === "string" && defaultTimezone.length > 0) {
    args.defaultTz = defaultTimezone;
  }
  if (typeof progressIntervalMs === "number") {
    args.progressIntervalMs = progressIntervalMs;
  }

  return call<BackfillSummary>("events_backfill_timezone", args);
}

export function cancelBackfill(): Promise<boolean> {
  return call<boolean>("events_backfill_timezone_cancel");
}

export function fetchBackfillStatus(householdId: string): Promise<BackfillStatusReport> {
  return call<BackfillStatusReport>("events_backfill_timezone_status", {
    householdId,
  });
}
