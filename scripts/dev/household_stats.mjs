#!/usr/bin/env node
/**
 * Household diagnostics formatter.
 * The shell and PowerShell wrappers call this script directly.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

function usage() {
  console.log(`Usage: node scripts/dev/household_stats.mjs [options]

Options:
  --db <path>   Override the SQLite database path.
  --json        Emit JSON instead of the table view.
  --help        Show this message.
`);
}

function parseArgs(argv) {
  const opts = { db: "", json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--db":
        if (i + 1 >= argv.length) {
          throw new Error("--db requires a path argument");
        }
        opts.db = argv[++i];
        break;
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function ensureTool(name) {
  const probe = spawnSync(name, ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (probe.error) {
    throw new Error(`${name} is required to run this helper`);
  }
}

function repoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Unable to determine repository root; ensure git is available.");
  }
  return result.stdout.trim();
}

function runCargoDiagnostics(root) {
  const args = [
    "run",
    "--quiet",
    "--manifest-path",
    path.join(root, "src-tauri", "Cargo.toml"),
    "--bin",
    "arklowdun",
    "--",
    "diagnostics",
    "household-stats",
    "--json",
  ];
  const result = spawnSync("cargo", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr || result.stdout;
    throw new Error(`Failed to execute household diagnostics command.\n${stderr}`);
  }
  const trimmed = result.stdout.trim();
  if (!trimmed) {
    throw new Error("Household diagnostics returned no data");
  }
  let rows;
  try {
    rows = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Unable to parse diagnostics JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected diagnostics payload; expected an array");
  }
  return rows;
}

function defaultDbPath() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "com.paula.arklowdun", "arklowdun.sqlite3");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appdata, "com.paula.arklowdun", "arklowdun.sqlite3");
  }
  return path.join(home, ".local", "share", "com.paula.arklowdun", "arklowdun.sqlite3");
}

function annotate(rows, dbPath) {
  const aliasOrder = [
    "notes",
    "events",
    "files",
    "bills",
    "policies",
    "propertyDocuments",
    "inventoryItems",
    "vehicles",
    "vehicleMaintenance",
    "pets",
    "petMedical",
    "familyMembers",
    "categories",
    "budgetCategories",
    "expenses",
    "shoppingItems",
    "noteLinks",
  ];

  const normalised = rows.map((row) => {
    const counts = {};
    if (row.counts && typeof row.counts === "object") {
      for (const [key, value] of Object.entries(row.counts)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          counts[key] = value;
        }
      }
    }
    const name = typeof row.name === "string" && row.name.trim().length > 0 ? row.name : row.id;
    return {
      id: String(row.id ?? ""),
      name,
      isDefault: Boolean(row.isDefault),
      counts,
    };
  });

  let cascadeMap = new Map();
  let vacuumSet = new Set();
  let deletedSet = new Set();

  try {
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: true });
      const checkpoints = db.prepare(
        "SELECT household_id, deleted_count, total, phase FROM cascade_checkpoints"
      ).all();
      cascadeMap = new Map(
        checkpoints.map((row) => [
          row.household_id,
          {
            deleted: Number(row.deleted_count ?? 0),
            total: Number(row.total ?? 0),
            phase: row.phase ?? "",
          },
        ]),
      );
      const vacuumRows = db.prepare(
        "SELECT household_id FROM cascade_vacuum_queue"
      ).all();
      vacuumSet = new Set(vacuumRows.map((row) => row.household_id));
      const deletedRows = db.prepare(
        "SELECT id FROM household WHERE deleted_at IS NOT NULL"
      ).all();
      deletedSet = new Set(deletedRows.map((row) => row.id));
      db.close();
    }
  } catch (err) {
    console.error(`Warning: failed to inspect ${dbPath}:`, err instanceof Error ? err.message : err);
  }

  const augmented = normalised.map((row) => {
    const cascade = cascadeMap.get(row.id);
    const vacuumPending = vacuumSet.has(row.id) ? 1 : 0;
    let health = "healthy";
    if (cascade) {
      health = "cascade_pending";
    } else if (vacuumPending) {
      health = "vacuum_pending";
    }
    if (deletedSet.has(row.id)) {
      health = "deleted";
    }
    return {
      ...row,
      cascade: cascade ? `${cascade.deleted}/${cascade.total}` : "0",
      vacuum: vacuumPending,
      health,
    };
  });

  return { aliasOrder, augmented };
}

function emitJson(rows) {
  console.log(JSON.stringify(rows, null, 2));
}

function emitTable(data) {
  const { aliasOrder, augmented } = data;
  const numericColumns = aliasOrder.filter((key) => augmented.some((row) => Object.hasOwn(row.counts, key)));
  const extraColumns = ["cascade", "vacuum", "health"];
  const headerColumns = ["Household ID", "Name", "Default"];
  const widths = new Map();

  function updateWidth(key, value) {
    const width = String(value).length;
    widths.set(key, Math.max(widths.get(key) ?? key.length, width));
  }

  for (const key of headerColumns.concat(numericColumns, extraColumns)) {
    widths.set(key, key.length);
  }

  for (const row of augmented) {
    updateWidth("Household ID", row.id);
    updateWidth("Name", row.name);
    updateWidth("Default", row.isDefault ? "yes" : "no");
    for (const key of numericColumns) {
      updateWidth(key, row.counts[key] ?? 0);
    }
    updateWidth("cascade", row.cascade);
    updateWidth("vacuum", row.vacuum);
    updateWidth("health", row.health);
  }

  const pad = (key, value, alignRight = false) => {
    const text = String(value);
    const width = widths.get(key) ?? text.length;
    return alignRight ? text.padStart(width, " ") : text.padEnd(width, " ");
  };

  let header = `${pad("Household ID", "Household ID")}  ${pad("Name", "Name")}  ${pad("Default", "Default")}`;
  for (const key of numericColumns) {
    header += `  ${pad(key, key, true)}`;
  }
  for (const key of extraColumns) {
    header += `  ${pad(key, key)}`;
  }
  console.log(header);

  for (const row of augmented) {
    let line = `${pad("Household ID", row.id)}  ${pad("Name", row.name)}  ${pad("Default", row.isDefault ? "yes" : "no")}`;
    for (const key of numericColumns) {
      line += `  ${pad(key, row.counts[key] ?? 0, true)}`;
    }
    line += `  ${pad("cascade", row.cascade)}  ${pad("vacuum", row.vacuum)}  ${pad("health", row.health)}`;
    console.log(line);
  }
}

try {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    usage();
    process.exit(0);
  }
  ensureTool("cargo");
  ensureTool("git");
  const root = repoRoot();
  const rows = runCargoDiagnostics(root);
  const dbPath = opts.db ? opts.db : defaultDbPath();
  const data = annotate(rows, dbPath);
  if (opts.json) {
    emitJson(data.augmented);
  } else {
    emitTable(data);
  }
  const unhealthy = data.augmented.some((row) => row.health !== "healthy");
  process.exit(unhealthy ? 1 : 0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
