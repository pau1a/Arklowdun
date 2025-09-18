export { SettingsPanel } from "./components/SettingsPanel";
export type { SettingsPanelInstance } from "./components/SettingsPanel";

export { fetchSettings, updateSettings } from "./api/settingsApi";
export type { SettingsUpdate } from "./api/settingsApi";

export type { Settings } from "./model/Settings";

export { useSettings } from "./hooks/useSettings";
export type { UseSettingsResult } from "./hooks/useSettings";

export {
  fetchAboutMetadata,
  fetchDiagnosticsSummary,
  openDiagnosticsDoc,
  resolveDiagnosticsDocPath,
} from "./api/diagnostics";
export type { AboutMetadata, DiagnosticsSummary } from "./api/diagnostics";
