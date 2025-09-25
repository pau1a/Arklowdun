import { call } from "@lib/ipc/call";
import type { ImportMode } from "@bindings/ImportMode";
import type { ImportPreviewDto } from "@bindings/ImportPreviewDto";
import type { ImportExecuteDto } from "@bindings/ImportExecuteDto";

export function previewImport(bundlePath: string, mode: ImportMode): Promise<ImportPreviewDto> {
  return call<ImportPreviewDto>("db_import_preview", { args: { bundlePath, mode } });
}

export function executeImport(
  bundlePath: string,
  mode: ImportMode,
  expectedPlanDigest: string,
): Promise<ImportExecuteDto> {
  return call<ImportExecuteDto>("db_import_execute", {
    args: { bundlePath, mode, expectedPlanDigest },
  });
}
