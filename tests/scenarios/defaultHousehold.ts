import type { ScenarioDefinition } from "../../src/lib/ipc/scenarioLoader";
import type { AttachmentExecutionSummary } from "../../src/bindings/AttachmentExecutionSummary";
import type { AttachmentsPlan } from "../../src/bindings/AttachmentsPlan";
import type { BackupEntry } from "../../src/bindings/BackupEntry";
import type { BackupManifest } from "../../src/bindings/BackupManifest";
import type { BackupOverview } from "../../src/bindings/BackupOverview";
import type { Event } from "../../src/bindings/Event";
import type { ExecutionReport } from "../../src/bindings/ExecutionReport";
import type { HardRepairOutcome } from "../../src/bindings/HardRepairOutcome";
import type { HardRepairRecoveryReport } from "../../src/bindings/HardRepairRecoveryReport";
import type { Note } from "../../src/bindings/Note";
import type { NoteLink } from "../../src/bindings/NoteLink";
import type { SearchResult } from "../../src/bindings/SearchResult";
import type { TableExecutionSummary } from "../../src/bindings/TableExecutionSummary";
import type { TablePlan } from "../../src/bindings/TablePlan";
import type { ValidationReport } from "../../src/bindings/ValidationReport";
import type { Vehicle } from "../../src/bindings/Vehicle";
import { createScenario, type ScenarioData } from "./base";

const TIMESTAMP = "2024-06-01T12:00:00Z";
const BASE_SECONDS = Math.floor(Date.parse(TIMESTAMP) / 1000);

const manifest: BackupManifest = {
  appVersion: "test",
  schemaHash: "schema-hash",
  dbSizeBytes: 2048,
  createdAt: TIMESTAMP,
  sha256: "sha256",
};

const backupEntry: BackupEntry = {
  directory: "/tmp/backups/default",
  sqlitePath: "/tmp/backups/default/app.db",
  manifestPath: "/tmp/backups/default/manifest.json",
  manifest,
  totalSizeBytes: 4096,
};

const overview: BackupOverview = {
  availableBytes: 10_000_000,
  dbSizeBytes: 4096,
  requiredFreeBytes: 8192,
  retentionMaxCount: 5,
  retentionMaxBytes: 50_000_000,
  backups: [backupEntry],
};

const attachmentsPlan: AttachmentsPlan = {
  adds: 1,
  updates: 0,
  skips: 0,
  conflicts: [],
};

const tablePlan: TablePlan = {
  adds: 1,
  updates: 0,
  skips: 0,
  conflicts: [],
};

const executionAttachments: AttachmentExecutionSummary = {
  adds: 1,
  updates: 0,
  skips: 0,
  conflicts: [],
};

const tableExecution: TableExecutionSummary = {
  adds: 1,
  updates: 0,
  skips: 0,
  conflicts: [],
};

const validation: ValidationReport = {
  bundleSizeBytes: BigInt(8192),
  dataFilesVerified: 1,
  attachmentsVerified: 1,
};

const executionReport: ExecutionReport = {
  mode: "merge",
  tables: { households: tableExecution },
  attachments: executionAttachments,
};

const recoveryReport: HardRepairRecoveryReport = {
  appVersion: "test",
  tables: { households: { attempted: 1, succeeded: 1, failed: 0 } },
  skippedExamples: [],
  completedAt: TIMESTAMP,
  integrityOk: true,
};

const hardRepairOutcome: HardRepairOutcome = {
  success: true,
  omitted: false,
  reportPath: "/tmp/hard-repair/report.json",
  preBackupDirectory: "/tmp/hard-repair/pre",
  archivedDbPath: "/tmp/hard-repair/archive.db",
  rebuiltDbPath: "/tmp/hard-repair/rebuilt.db",
  recovery: recoveryReport,
};

const households = [
  {
    id: "hh-default",
    name: "Default Household",
    tz: "UTC",
    color: "#2563EB",
    is_default: true,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: null,
  },
];

const events: Event[] = [
  {
    id: "evt-maintenance",
    household_id: "hh-default",
    title: "Boiler service",
    tz: "UTC",
    start_at_utc: BASE_SECONDS + 3600,
    end_at_utc: BASE_SECONDS + 7200,
    rrule: undefined,
    exdates: undefined,
    reminder: 900,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    series_parent_id: undefined,
  },
];

const notes: Note[] = [
  {
    id: "note-maintenance",
    household_id: "hh-default",
    category_id: undefined,
    position: 0,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    text: "Replace HVAC filter",
    color: "#2563EB",
    x: 0,
    y: 0,
    z: 0,
    deadline: BASE_SECONDS + 86400,
    deadline_tz: "UTC",
  },
];

const noteLinks: NoteLink[] = [
  {
    id: "link-maintenance",
    household_id: "hh-default",
    note_id: "note-maintenance",
    entity_type: "event",
    entity_id: "evt-maintenance",
    relation: "related",
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
  },
];

const vehicles: Vehicle[] = [
  {
    id: "veh-van",
    household_id: "hh-default",
    name: "Family Van",
    make: "VW",
    model: "Transporter",
    reg: "VAN1",
    vin: "VIN123",
    next_mot_due: BASE_SECONDS + 2_592_000,
    next_service_due: BASE_SECONDS + 5_184_000,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    position: 0,
  },
];

const searchResults: SearchResult[] = [
  {
    kind: "Event",
    id: "evt-maintenance",
    title: "Boiler service",
    start_at_utc: BASE_SECONDS + 3600,
    tz: "UTC",
  },
];

const scenarioData: ScenarioData = {
  households,
  activeHouseholdId: "hh-default",
  events,
  notes,
  noteLinks,
  vehicles,
  searchResults,
  backups: {
    manifest,
    overview,
    entries: [backupEntry],
    exportEntry: {
      directory: "/tmp/export",
      manifestPath: "/tmp/export/manifest.json",
      verifyShPath: "/tmp/export/verify.sh",
      verifyPs1Path: "/tmp/export/verify.ps1",
    },
  },
  imports: {
    preview: {
      bundlePath: "/tmp/import.zip",
      mode: "merge",
      validation,
      plan: { mode: "merge", tables: { households: tablePlan }, attachments: attachmentsPlan },
      planDigest: "digest",
    },
    execute: {
      bundlePath: "/tmp/import.zip",
      mode: "merge",
      validation,
      plan: { mode: "merge", tables: { households: tablePlan }, attachments: attachmentsPlan },
      planDigest: "digest",
      execution: executionReport,
      reportPath: "/tmp/import-report.json",
    },
  },
  repair: {
    validation,
    hard: hardRepairOutcome,
  },
};

export default function defaultHouseholdScenario(): ScenarioDefinition {
  return createScenario({
    name: "defaultHousehold",
    description: "Single household with baseline fixtures",
    data: scenarioData,
    metadata: { health: "healthy" },
  });
}
