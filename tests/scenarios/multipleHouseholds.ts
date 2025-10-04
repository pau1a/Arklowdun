import type { ScenarioDefinition } from "../../src/lib/ipc/scenarioLoader";
import type { Event } from "../../src/bindings/Event";
import type { Note } from "../../src/bindings/Note";
import type { NoteLink } from "../../src/bindings/NoteLink";
import type { SearchResult } from "../../src/bindings/SearchResult";
import type { Vehicle } from "../../src/bindings/Vehicle";
import type { Category } from "../../src/bindings/Category";
import { createScenario, type ScenarioData } from "./base";

const TIMESTAMP = "2024-06-01T12:00:00Z";
const BASE_SECONDS = Math.floor(Date.parse(TIMESTAMP) / 1000);

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
  {
    id: "hh-coastal",
    name: "Coastal Retreat",
    tz: "Europe/Dublin",
    color: "#059669",
    is_default: false,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: null,
  },
];

const events: Event[] = [
  {
    id: "evt-default-1",
    household_id: "hh-default",
    title: "School run",
    tz: "UTC",
    start_at_utc: BASE_SECONDS + 1800,
    end_at_utc: BASE_SECONDS + 3600,
    rrule: undefined,
    exdates: undefined,
    reminder: 600,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    series_parent_id: undefined,
  },
  {
    id: "evt-coastal-1",
    household_id: "hh-coastal",
    title: "Garden cleanup",
    tz: "Europe/Dublin",
    start_at_utc: BASE_SECONDS + 7200,
    end_at_utc: BASE_SECONDS + 9000,
    rrule: undefined,
    exdates: undefined,
    reminder: 600,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    series_parent_id: undefined,
  },
];

const notes: Note[] = [
  {
    id: "note-default",
    household_id: "hh-default",
    category_id: "cat-default",
    position: 0,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    text: "Pick up groceries",
    color: "#2563EB",
    x: 0,
    y: 0,
    z: 0,
    deadline: BASE_SECONDS + 43200,
    deadline_tz: "UTC",
  },
  {
    id: "note-coastal",
    household_id: "hh-coastal",
    category_id: "cat-coastal",
    position: 1,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    text: "Check storm shutters",
    color: "#059669",
    x: 50,
    y: 10,
    z: 0,
    deadline: BASE_SECONDS + 172800,
    deadline_tz: "Europe/Dublin",
  },
];

const noteLinks: NoteLink[] = [
  {
    id: "link-default",
    household_id: "hh-default",
    note_id: "note-default",
    entity_type: "event",
    entity_id: "evt-default-1",
    relation: "related",
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
  },
  {
    id: "link-coastal",
    household_id: "hh-coastal",
    note_id: "note-coastal",
    entity_type: "event",
    entity_id: "evt-coastal-1",
    relation: "related",
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
  },
];

const categories: Category[] = [
  {
    id: "cat-default",
    household_id: "hh-default",
    name: "Default",
    slug: "default",
    color: "#2563EB",
    position: 0,
    z: 0,
    is_visible: true,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
  },
  {
    id: "cat-coastal",
    household_id: "hh-coastal",
    name: "Coastal",
    slug: "coastal",
    color: "#059669",
    position: 0,
    z: 0,
    is_visible: true,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
  },
];

const vehicles: Vehicle[] = [
  {
    id: "veh-default",
    household_id: "hh-default",
    name: "City Car",
    make: "Toyota",
    model: "Corolla",
    reg: "CITY1",
    vin: "VIN-CITY",
    next_mot_due: BASE_SECONDS + 2_592_000,
    next_service_due: BASE_SECONDS + 5_184_000,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    position: 0,
  },
  {
    id: "veh-coastal",
    household_id: "hh-coastal",
    name: "Beach Jeep",
    make: "Jeep",
    model: "Wrangler",
    reg: "BEACH",
    vin: "VIN-BEACH",
    next_mot_due: BASE_SECONDS + 3_456_000,
    next_service_due: BASE_SECONDS + 6_912_000,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    position: 1,
  },
];

const searchResults: SearchResult[] = [
  {
    kind: "Event",
    id: "evt-coastal-1",
    title: "Garden cleanup",
    start_at_utc: BASE_SECONDS + 7200,
    tz: "Europe/Dublin",
  },
];

const scenarioData: ScenarioData = {
  households,
  activeHouseholdId: "hh-coastal",
  events,
  notes,
  noteLinks,
  vehicles,
  searchResults,
  categories,
  backups: {
    manifest: {
      appVersion: "test",
      schemaHash: "schema-hash",
      dbSizeBytes: 4096,
      createdAt: TIMESTAMP,
      sha256: "sha",
    },
    overview: {
      availableBytes: 8_000_000,
      dbSizeBytes: 4096,
      requiredFreeBytes: 4096,
      retentionMaxCount: 5,
      retentionMaxBytes: 40_000_000,
      backups: [],
    },
    entries: [],
    exportEntry: {
      directory: "/tmp/export-multi",
      manifestPath: "/tmp/export-multi/manifest.json",
      verifyShPath: "/tmp/export-multi/verify.sh",
      verifyPs1Path: "/tmp/export-multi/verify.ps1",
    },
  },
  imports: {
    preview: {
      bundlePath: "/tmp/import-multi.zip",
      mode: "merge",
      validation: {
        bundleSizeBytes: BigInt(4096),
        dataFilesVerified: 2,
        attachmentsVerified: 0,
      },
      plan: {
        mode: "merge",
        tables: {
          households: { adds: 1, updates: 1, skips: 0, conflicts: [] },
        },
        attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] },
      },
      planDigest: "multi",
    },
    execute: {
      bundlePath: "/tmp/import-multi.zip",
      mode: "merge",
      validation: {
        bundleSizeBytes: BigInt(4096),
        dataFilesVerified: 2,
        attachmentsVerified: 0,
      },
      plan: {
        mode: "merge",
        tables: {
          households: { adds: 1, updates: 1, skips: 0, conflicts: [] },
        },
        attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] },
      },
      planDigest: "multi",
      execution: {
        mode: "merge",
        tables: {
          households: { adds: 1, updates: 1, skips: 0, conflicts: [] },
        },
        attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] },
      },
      reportPath: "/tmp/import-multi-report.json",
    },
  },
  repair: {
    validation: {
      bundleSizeBytes: BigInt(2048),
      dataFilesVerified: 2,
      attachmentsVerified: 0,
    },
    hard: {
      success: true,
      omitted: false,
      reportPath: "/tmp/hard-repair-multi/report.json",
      preBackupDirectory: "/tmp/hard-repair-multi/pre",
      archivedDbPath: "/tmp/hard-repair-multi/archive.db",
      rebuiltDbPath: "/tmp/hard-repair-multi/rebuilt.db",
      recovery: {
        appVersion: "test",
        tables: { households: { attempted: 2, succeeded: 2, failed: 0 } },
        skippedExamples: [],
        completedAt: TIMESTAMP,
        integrityOk: true,
      },
    },
  },
};

export default function multipleHouseholds(): ScenarioDefinition {
  return createScenario({
    name: "multipleHouseholds",
    description: "Two active households with independent data",
    data: scenarioData,
    metadata: { health: "healthy" },
  });
}
