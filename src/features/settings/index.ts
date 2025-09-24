export { SettingsPanel } from "./components/SettingsPanel";
export type { SettingsPanelInstance } from "./components/SettingsPanel";

export { fetchSettings, updateSettings } from "./api/settingsApi";
export type { SettingsUpdate } from "./api/settingsApi";

export type { Settings } from "./model/Settings";

export { useSettings } from "./hooks/useSettings";
export type { UseSettingsResult } from "./hooks/useSettings";

export {
  fetchBackupOverview,
  createBackup,
  revealBackup,
  revealBackupFolder,
} from "./api/backups";
export type { BackupEntry } from "@bindings/BackupEntry";
export type { BackupOverview } from "@bindings/BackupOverview";
export type { BackupManifest } from "@bindings/BackupManifest";

export { runRepair, listenRepairEvents } from "./api/repair";
export type { DbRepairSummary } from "@bindings/DbRepairSummary";
export type { DbRepairEvent } from "@bindings/DbRepairEvent";
export type { DbRepairStep } from "@bindings/DbRepairStep";
export type { DbRepairStepState } from "@bindings/DbRepairStepState";

export {
  fetchAboutMetadata,
  fetchDiagnosticsSummary,
  openDiagnosticsDoc,
  resolveDiagnosticsDocPath,
} from "./api/diagnostics";
export type { AboutMetadata, DiagnosticsSummary } from "./api/diagnostics";
