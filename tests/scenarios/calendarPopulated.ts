import type { ScenarioDefinition } from "../../src/lib/ipc/scenarioLoader";
import type { Event } from "../../src/bindings/Event";
import type { Note } from "../../src/bindings/Note";
import type { NoteLink } from "../../src/bindings/NoteLink";
import type { SearchResult } from "../../src/bindings/SearchResult";
import type { Vehicle } from "../../src/bindings/Vehicle";
import { createScenario, type ScenarioData } from "./base";

const TIMESTAMP = "2024-06-01T12:00:00Z";
const BASE_SECONDS = Math.floor(Date.parse(TIMESTAMP) / 1000);

const households = [
  {
    id: "hh-calendar",
    name: "Calendar Lab",
    tz: "UTC",
    color: "#7C3AED",
    is_default: true,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: null,
  },
];

const events: Event[] = Array.from({ length: 6 }).map((_, index) => {
  const start = BASE_SECONDS + index * 86_400;
  return {
    id: `evt-calendar-${index + 1}`,
    household_id: "hh-calendar",
    title: `Event ${index + 1}`,
    tz: "UTC",
    start_at_utc: start,
    end_at_utc: start + 3_600,
    rrule: undefined,
    exdates: undefined,
    reminder: 600,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    series_parent_id: undefined,
  } satisfies Event;
});

const notes: Note[] = [
  {
    id: "note-calendar",
    household_id: "hh-calendar",
    category_id: undefined,
    position: 0,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    text: "Calendar annotations",
    color: "#7C3AED",
    x: 0,
    y: 0,
    z: 0,
    deadline: BASE_SECONDS + 604_800,
    deadline_tz: "UTC",
  },
];

const noteLinks: NoteLink[] = events.slice(0, 3).map((event, index) => ({
  id: `link-calendar-${index + 1}`,
  household_id: "hh-calendar",
  note_id: "note-calendar",
  entity_type: "event",
  entity_id: event.id,
  relation: "related",
  created_at: BASE_SECONDS,
  updated_at: BASE_SECONDS,
}));

const vehicles: Vehicle[] = [
  {
    id: "veh-calendar",
    household_id: "hh-calendar",
    name: "Delivery Van",
    make: "Ford",
    model: "Transit",
    reg: "CAL1",
    vin: "VIN-CALENDAR",
    next_mot_due: BASE_SECONDS + 4_147_200,
    next_service_due: BASE_SECONDS + 6_912_000,
    created_at: BASE_SECONDS,
    updated_at: BASE_SECONDS,
    deleted_at: undefined,
    position: 0,
  },
];

const searchResults: SearchResult[] = events.map((event) => ({
  kind: "Event",
  id: event.id,
  title: event.title,
  start_at_utc: event.start_at_utc,
  tz: "UTC",
}));

const scenarioData: ScenarioData = {
  households,
  activeHouseholdId: "hh-calendar",
  events,
  notes,
  noteLinks,
  vehicles,
  searchResults,
  backups: {
    manifest: {
      appVersion: "test",
      schemaHash: "schema-hash",
      dbSizeBytes: 4096,
      createdAt: TIMESTAMP,
      sha256: "sha",
    },
    overview: {
      availableBytes: 6_000_000,
      dbSizeBytes: 4096,
      requiredFreeBytes: 4096,
      retentionMaxCount: 3,
      retentionMaxBytes: 12_000_000,
      backups: [],
    },
    entries: [],
    exportEntry: {
      directory: "/tmp/export-calendar",
      manifestPath: "/tmp/export-calendar/manifest.json",
      verifyShPath: "/tmp/export-calendar/verify.sh",
      verifyPs1Path: "/tmp/export-calendar/verify.ps1",
    },
  },
  imports: {
    preview: {
      bundlePath: "/tmp/import-calendar.zip",
      mode: "merge",
      validation: {
        bundleSizeBytes: BigInt(4096),
        dataFilesVerified: 3,
        attachmentsVerified: 1,
      },
      plan: {
        mode: "merge",
        tables: {
          events: { adds: 6, updates: 0, skips: 0, conflicts: [] },
        },
        attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] },
      },
      planDigest: "calendar",
    },
    execute: {
      bundlePath: "/tmp/import-calendar.zip",
      mode: "merge",
      validation: {
        bundleSizeBytes: BigInt(4096),
        dataFilesVerified: 3,
        attachmentsVerified: 1,
      },
      plan: {
        mode: "merge",
        tables: {
          events: { adds: 6, updates: 0, skips: 0, conflicts: [] },
        },
        attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] },
      },
      planDigest: "calendar",
      execution: {
        mode: "merge",
        tables: {
          events: { adds: 6, updates: 0, skips: 0, conflicts: [] },
        },
        attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] },
      },
      reportPath: "/tmp/import-calendar-report.json",
    },
  },
  repair: {
    validation: {
      bundleSizeBytes: BigInt(1024),
      dataFilesVerified: 3,
      attachmentsVerified: 1,
    },
    hard: {
      success: true,
      omitted: false,
      reportPath: "/tmp/hard-repair-calendar/report.json",
      preBackupDirectory: "/tmp/hard-repair-calendar/pre",
      archivedDbPath: "/tmp/hard-repair-calendar/archive.db",
      rebuiltDbPath: "/tmp/hard-repair-calendar/rebuilt.db",
      recovery: {
        appVersion: "test",
        tables: { events: { attempted: 6, succeeded: 6, failed: 0 } },
        skippedExamples: [],
        completedAt: TIMESTAMP,
        integrityOk: true,
      },
    },
  },
};

export default function calendarPopulated(): ScenarioDefinition {
  return createScenario({
    name: "calendarPopulated",
    description: "Calendar-heavy fixture with multiple events",
    data: scenarioData,
    metadata: { health: "healthy" },
  });
}
