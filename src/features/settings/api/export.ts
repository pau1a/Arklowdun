import { call } from "@lib/ipc/call";
import type { ExportEntryDto } from "@bindings/ExportEntryDto";

export function runExport(outParent: string): Promise<ExportEntryDto> {
  return call<ExportEntryDto>("db_export_run", { outParent });
}

