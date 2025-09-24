import { call } from "@lib/ipc/call";
import type { BackupEntry } from "@bindings/BackupEntry";
import type { BackupOverview } from "@bindings/BackupOverview";

export function fetchBackupOverview(): Promise<BackupOverview> {
  return call<BackupOverview>("db_backup_overview");
}

export function createBackup(): Promise<BackupEntry> {
  return call<BackupEntry>("db_backup_create");
}

export function revealBackup(path: string): Promise<void> {
  return call("db_backup_reveal", { path });
}

export function revealBackupFolder(): Promise<void> {
  return call("db_backup_reveal_root");
}
