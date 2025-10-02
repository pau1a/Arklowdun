import { invoke } from "@tauri-apps/api/core";

interface HouseholdRecordRaw {
  id: string;
  name?: string | null;
  is_default?: boolean | number | null;
  tz?: string | null;
}

export interface HouseholdRecord {
  id: string;
  name: string;
  isDefault: boolean;
  tz: string | null;
}

function normalizeHousehold(record: HouseholdRecordRaw): HouseholdRecord {
  const name = typeof record.name === "string" && record.name.trim().length > 0
    ? record.name
    : record.id;
  const isDefault = Boolean(record.is_default);
  const tz = typeof record.tz === "string" && record.tz.trim().length > 0 ? record.tz : null;
  return {
    id: record.id,
    name,
    isDefault,
    tz,
  };
}

export async function listHouseholds(): Promise<HouseholdRecord[]> {
  const rows = await invoke<HouseholdRecordRaw[]>("household_list_all");
  return rows.map(normalizeHousehold);
}

export async function getActiveHouseholdId(): Promise<string> {
  return invoke<string>("household_get_active");
}

export type SetActiveHouseholdErrorCode =
  | "HOUSEHOLD_NOT_FOUND"
  | "HOUSEHOLD_DELETED";

export type SetActiveHouseholdResult =
  | { ok: true }
  | { ok: false; code: SetActiveHouseholdErrorCode };

function extractErrorCode(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "UNKNOWN";
}

export async function setActiveHouseholdId(id: string): Promise<SetActiveHouseholdResult> {
  try {
    await invoke("household_set_active", { id });
    return { ok: true };
  } catch (error) {
    const code = extractErrorCode(error);
    if (code === "HOUSEHOLD_NOT_FOUND" || code === "HOUSEHOLD_DELETED") {
      return { ok: false, code };
    }
    throw error;
  }
}
