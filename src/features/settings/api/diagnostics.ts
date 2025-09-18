import { call } from "@lib/ipc/call";

export interface DiagnosticsSummary {
  platform: string;
  arch: string;
  appVersion: string;
  commitHash: string;
  rustLog?: string;
  rustLogSource?: string;
  logPath: string;
  logAvailable: boolean;
  logTail: string[];
  logTruncated: boolean;
  logLinesReturned: number;
}

export interface AboutMetadata {
  appVersion: string;
  commitHash: string;
}

export function fetchDiagnosticsSummary(): Promise<DiagnosticsSummary> {
  return call<DiagnosticsSummary>("diagnostics_summary");
}

export function fetchAboutMetadata(): Promise<AboutMetadata> {
  return call<AboutMetadata>("about_metadata");
}

export function resolveDiagnosticsDocPath(): Promise<string> {
  return call<string>("diagnostics_doc_path");
}

export function openDiagnosticsDoc(): Promise<void> {
  return call<void>("open_diagnostics_doc");
}
