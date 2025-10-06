import { getActiveHouseholdId } from "../../api/households";
import { call } from "@lib/ipc/call";

export type IndexMode = "full" | "incremental";
export type IndexerState = "Idle" | "Building" | "Cancelling" | "Error";

export interface IndexStatus {
  lastBuiltAt: string | null;
  rowCount: number;
  state: IndexerState;
}

export interface IndexStatusResult {
  householdId: string;
  status: IndexStatus;
}

export interface IndexSummary {
  total: number;
  updated: number;
  durationMs: number;
}

export interface FilesIndexProgressPayload {
  household_id: string;
  scanned: number;
  updated: number;
  skipped: number;
}

export interface FilesIndexStatePayload {
  household_id: string;
  state: IndexerState;
}

async function resolveHouseholdId(householdId?: string): Promise<string> {
  if (householdId && householdId.trim().length > 0) {
    return householdId;
  }
  return getActiveHouseholdId();
}

export async function rebuildIndex(
  mode: IndexMode,
  householdId?: string,
): Promise<IndexSummary> {
  const id = await resolveHouseholdId(householdId);
  const summary = await call<{
    total: number;
    updated: number;
    duration_ms: number;
  }>("files_index_rebuild", { householdId: id, mode });
  return {
    total: Number(summary.total ?? 0),
    updated: Number(summary.updated ?? 0),
    durationMs: Number(summary.duration_ms ?? 0),
  };
}

export async function getIndexStatus(
  householdId?: string,
): Promise<IndexStatusResult> {
  const id = await resolveHouseholdId(householdId);
  const raw = await call<{
    last_built_at: string | null;
    row_count: number;
    state: IndexerState;
  }>("files_index_status", { householdId: id });
  return {
    householdId: id,
    status: {
      lastBuiltAt: typeof raw.last_built_at === "string" ? raw.last_built_at : null,
      rowCount: Number(raw.row_count ?? 0),
      state: raw.state,
    },
  };
}

export async function cancelIndexRebuild(householdId?: string): Promise<void> {
  const id = await resolveHouseholdId(householdId);
  await call("files_index_cancel", { householdId: id });
}
