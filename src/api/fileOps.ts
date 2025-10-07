import type { AttachmentCategory } from "@bindings/AttachmentCategory";

import { call } from "@lib/ipc/call";

export type ConflictStrategy = "rename" | "fail";

export interface MoveFileParams {
  householdId: string;
  fromCategory: AttachmentCategory;
  fromRelativePath: string;
  toCategory: AttachmentCategory;
  toRelativePath: string;
  conflict?: ConflictStrategy;
}

export interface MoveFileResult {
  moved: number;
  renamed: boolean;
}

export type AttachmentsRepairMode = "scan" | "apply";

export interface AttachmentsRepairAction {
  tableName: string;
  rowId: number;
  action: "detach" | "mark" | "relink";
  newCategory?: AttachmentCategory;
  newRelativePath?: string;
}

export interface AttachmentsRepairParams {
  householdId: string;
  mode: AttachmentsRepairMode;
  actions?: AttachmentsRepairAction[];
  cancel?: boolean;
}

export interface AttachmentsRepairResult {
  scanned: number;
  missing: number;
  repaired: number;
  cancelled: boolean;
}

export function moveFile(params: MoveFileParams): Promise<MoveFileResult> {
  const payload = {
    household_id: params.householdId,
    from_category: params.fromCategory,
    from_rel: params.fromRelativePath,
    to_category: params.toCategory,
    to_rel: params.toRelativePath,
    conflict: params.conflict ?? "rename",
  } as const;
  return call("file_move", payload) as Promise<MoveFileResult>;
}

export function runAttachmentsRepair(
  params: AttachmentsRepairParams,
): Promise<AttachmentsRepairResult> {
  const payload = {
    household_id: params.householdId,
    mode: params.mode,
    cancel: params.cancel ?? false,
    actions: params.actions?.map((action) => ({
      table_name: action.tableName,
      row_id: action.rowId,
      action: action.action,
      new_category: action.newCategory,
      new_relative_path: action.newRelativePath,
    })),
  } as const;
  return call("attachments_repair", payload) as Promise<AttachmentsRepairResult>;
}

export function cancelAttachmentsRepair(householdId: string): Promise<void> {
  return call("attachments_repair", {
    household_id: householdId,
    mode: "scan",
    cancel: true,
  }).then(() => undefined);
}

export function exportAttachmentsRepairManifest(householdId: string): Promise<string> {
  return call("attachments_repair_manifest_export", {
    household_id: householdId,
  }) as Promise<string>;
}
