import type { ContractRequest, ContractResponse, IpcCommand } from "./port";
import type { Clock } from "@lib/runtime/clock";
import type { Rng } from "@lib/runtime/rng";

export interface ScenarioContext {
  clock: Clock;
  rng: Rng;
}

export type ScenarioHandler<K extends IpcCommand> = (
  payload: ContractRequest<K>,
  context: ScenarioContext,
) => Promise<ContractResponse<K>> | ContractResponse<K>;

export type ScenarioHandlers = {
  [K in IpcCommand]?: ScenarioHandler<K>;
};

export interface ScenarioDefinition {
  name: string;
  description?: string;
  handlers: ScenarioHandlers;
  metadata?: Record<string, unknown>;
}

type ScenarioModule = { default: () => ScenarioDefinition; slug?: string };

let scenarioModules: Record<string, ScenarioModule> = {};

try {
  const metaAny = import.meta as unknown as Record<string, unknown>;
  const glob = typeof metaAny.glob === "function"
    ? (metaAny.glob as (pattern: string, options: { eager: boolean }) => Record<string, ScenarioModule>)
    : null;
  if (glob) {
    const patterns = [
      "../../../tests/scenarios/*.ts",
      "../../tests/scenarios/*.ts",
    ];

    for (const pattern of patterns) {
      const matches = glob(pattern, { eager: true });
      if (Object.keys(matches).length > 0) {
        scenarioModules = matches;
        break;
      }
    }
  }
} catch {
  scenarioModules = {};
}

const registry = new Map<string, ScenarioDefinition>();

for (const [path, mod] of Object.entries(scenarioModules)) {
  const definition = mod.default();
  const key = mod.slug ?? definition.name ?? path;
  registry.set(key, definition);
}

if (registry.size === 0) {
  registry.set("fallback", {
    name: "fallback",
    description: "Built-in fallback scenario used when Playwright fixtures are unavailable.",
    metadata: { health: "healthy" },
    handlers: {
      household_list: () => [
        {
          id: "fallback-household",
          name: "Fallback household",
          tz: "UTC",
          color: "#2563EB",
          is_default: true,
          is_active: true,
          created_at: 0,
          updated_at: 0,
          deleted_at: null,
        },
      ],
      household_get_active: () => "fallback-household",
      events_list_range: () => ({ items: [], truncated: false, limit: 100 }),
      notes_list_cursor: () => ({ notes: [] }),
      notes_list_by_deadline_range: () => ({ items: [] }),
      notes_list_for_entity: () => ({ notes: [], links: [] }),
      notes_quick_create_for_entity: () => ({ notes: [], links: [] }),
      note_links_list_by_entity: () => ({ items: [] }),
      note_links_get_for_note: () => ({ items: [] }),
      categories_list: () => [],
      search_entities: () => [],
      vehicles_list: () => [],
      vehicles_get: () => null,
      diagnostics_summary: () => ({ ok: true }),
      diagnostics_household_stats: () => ({ households: 1 }),
      bills_list_due_between: () => [],
      policies_list: () => [],
      db_backup_overview: () => ({
        availableBytes: 0,
        dbSizeBytes: 0,
        requiredFreeBytes: 0,
        retentionMaxBytes: 0,
        retentionMaxCount: 0,
        backups: [],
      }),
      db_backup_create: () => ({
        directory: "",
        sqlitePath: "",
        manifestPath: "",
        manifest: {
          appVersion: "fallback",
          schemaHash: "",
          dbSizeBytes: 0,
          createdAt: new Date(0).toISOString(),
          sha256: "",
        },
        totalSizeBytes: 0,
      }),
      db_export_run: () => ({
        directory: "",
        manifestPath: "",
        verifyShPath: "",
        verifyPs1Path: "",
      }),
      db_import_preview: () => ({
        bundlePath: "",
        mode: "merge",
        validation: {
          bundleSizeBytes: BigInt(0),
          dataFilesVerified: 0,
          attachmentsVerified: 0,
        },
        plan: { mode: "merge", tables: {}, attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] } },
        planDigest: "",
      }),
      db_import_execute: () => ({
        bundlePath: "",
        mode: "merge",
        validation: {
          bundleSizeBytes: BigInt(0),
          dataFilesVerified: 0,
          attachmentsVerified: 0,
        },
        plan: { mode: "merge", tables: {}, attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] } },
        planDigest: "",
        execution: { mode: "merge", tables: {}, attachments: { adds: 0, updates: 0, skips: 0, conflicts: [] } },
        reportPath: "",
      }),
      db_files_index_ready: () => true,
    },
  });
}

export class ScenarioLoader {
  constructor(private readonly scenarios = registry) {}

  list(): string[] {
    return Array.from(this.scenarios.keys()).sort();
  }

  load(name?: string): ScenarioDefinition {
    if (name && this.scenarios.has(name)) {
      return this.scenarios.get(name)!;
    }
    const first = this.scenarios.values().next();
    if (!first.value) {
      throw new Error("No scenarios registered");
    }
    return first.value;
  }
}
