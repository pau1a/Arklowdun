import { call } from "@lib/ipc/call";

export type MigrationMode = "dry_run" | "apply";

export interface MigrationCounts {
  processed: number;
  copied: number;
  skipped: number;
  conflicts: number;
  unsupported: number;
}

export interface MigrationProgress {
  mode: MigrationMode;
  table?: string | null;
  counts: MigrationCounts;
  completed: boolean;
  manifest_path?: string | null;
  checkpoint_path?: string | null;
}

export function fetchMigrationStatus(): Promise<MigrationProgress> {
  return call("attachments_migration_status");
}

export function runMigration(mode: MigrationMode): Promise<MigrationProgress> {
  return call("attachments_migrate", { mode });
}
