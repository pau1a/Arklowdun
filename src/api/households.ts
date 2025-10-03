import type { AppError } from "@bindings/AppError";
import { call } from "@lib/ipc/call";

interface HouseholdRecordRaw {
  id: string;
  name?: string | null;
  is_default?: boolean | number | null;
  tz?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  deleted_at?: number | null;
  color?: string | null;
}

export interface HouseholdRecord {
  id: string;
  name: string;
  isDefault: boolean;
  tz: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
  color: string | null;
}

function normalizeHousehold(record: HouseholdRecordRaw): HouseholdRecord {
  const name =
    typeof record.name === "string" && record.name.trim().length > 0
      ? record.name
      : record.id;
  const isDefault = Boolean(record.is_default);
  const tz =
    typeof record.tz === "string" && record.tz.trim().length > 0
      ? record.tz
      : null;
  return {
    id: record.id,
    name,
    isDefault,
    tz,
    createdAt: typeof record.created_at === "number" ? record.created_at : null,
    updatedAt: typeof record.updated_at === "number" ? record.updated_at : null,
    deletedAt: typeof record.deleted_at === "number" ? record.deleted_at : null,
    color:
      typeof record.color === "string" && record.color.trim().length > 0
        ? record.color
        : null,
  };
}

export async function listHouseholds(
  includeDeleted = false,
): Promise<HouseholdRecord[]> {
  const rows = await call<HouseholdRecordRaw[]>("household_list", {
    includeDeleted,
  });
  return rows.map(normalizeHousehold);
}

export async function getActiveHouseholdId(): Promise<string> {
  return call<string>("household_get_active");
}

export type HouseholdErrorCode =
  | "DEFAULT_UNDELETABLE"
  | "HOUSEHOLD_NOT_FOUND"
  | "HOUSEHOLD_DELETED"
  | "HOUSEHOLD_ALREADY_ACTIVE";

export const HOUSEHOLD_ERROR_MESSAGES: Record<HouseholdErrorCode, string> = {
  DEFAULT_UNDELETABLE: "The default household cannot be deleted.",
  HOUSEHOLD_NOT_FOUND: "The selected household could not be found.",
  HOUSEHOLD_DELETED: "The selected household has been archived.",
  HOUSEHOLD_ALREADY_ACTIVE: "The selected household is already active.",
};

export type SetActiveHouseholdErrorCode = Extract<
  HouseholdErrorCode,
  "HOUSEHOLD_NOT_FOUND" | "HOUSEHOLD_DELETED" | "HOUSEHOLD_ALREADY_ACTIVE"
>;

export type SetActiveHouseholdResult =
  | { ok: true }
  | { ok: false; code: SetActiveHouseholdErrorCode };

function extractErrorCode(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const appError = error as Partial<AppError> & { message?: unknown };
    if (typeof appError.code === "string" && appError.code !== "APP/UNKNOWN") {
      return appError.code;
    }
    if (typeof appError.message === "string") {
      return appError.message;
    }
  }
  return "UNKNOWN";
}

export async function setActiveHouseholdId(
  id: string,
): Promise<SetActiveHouseholdResult> {
  try {
    await call("household_set_active", { id });
    return { ok: true };
  } catch (error) {
    const code = extractErrorCode(error);
    if (
      code === "HOUSEHOLD_NOT_FOUND" ||
      code === "HOUSEHOLD_DELETED" ||
      code === "HOUSEHOLD_ALREADY_ACTIVE"
    ) {
      return { ok: false, code };
    }
    throw error;
  }
}

export async function getHousehold(
  id: string,
): Promise<HouseholdRecord | null> {
  const record = await call<HouseholdRecordRaw | null>("household_get", { id });
  return record ? normalizeHousehold(record) : null;
}

export async function createHousehold(
  name: string,
  color: string | null,
): Promise<HouseholdRecord> {
  const record = await call<HouseholdRecordRaw>("household_create", {
    name,
    color,
  });
  return normalizeHousehold(record);
}

export interface UpdateHouseholdInput {
  name?: string;
  color?: string | null;
}

export async function updateHousehold(
  id: string,
  input: UpdateHouseholdInput,
): Promise<HouseholdRecord> {
  const record = await call<HouseholdRecordRaw>("household_update", {
    id,
    name: input.name,
    color: input.color,
  });
  return normalizeHousehold(record);
}

export interface DeleteHouseholdResponse {
  fallbackId: string | null;
}

export async function deleteHousehold(
  id: string,
): Promise<DeleteHouseholdResponse> {
  const result = await call<{ fallbackId?: string | null }>(
    "household_delete",
    { id },
  );
  return {
    fallbackId: result?.fallbackId ?? null,
  };
}

export async function restoreHousehold(id: string): Promise<HouseholdRecord> {
  const record = await call<HouseholdRecordRaw>("household_restore", { id });
  return normalizeHousehold(record);
}
