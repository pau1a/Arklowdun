import { promises as fs } from "fs";
import Database from "better-sqlite3";
import { newUuidV7 } from "../db/id.ts";
import { toMs } from "../db/normalize.ts";
import { sanitizeRelativePath } from "../files/sanitize.ts";

const DOMAIN_TABLES = new Set([
  "household",
  "events",
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "vehicles",
  "vehicle_maintenance",
  "pets",
  "pet_medical",
  "family_members",
  "budget_categories",
  "expenses",
]);

const POSITION_TABLES = new Set([
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "vehicles",
  "pets",
  "family_members",
  "budget_categories",
]);

const TIMESTAMP_FIELDS = new Set([
  "created_at",
  "updated_at",
  "deleted_at",
  "due_date",
  "renewal_date",
  "purchase_date",
  "warranty_expiry",
  "mot_date",
  "service_date",
  "mot_reminder",
  "service_reminder",
  "datetime",
  "reminder",
  "date",
  "birthday",
]);

const SENTINEL_KEY = "import-json";

interface TableRows {
  [table: string]: any[];
}

function usage(): void {
  console.error(
    "Usage: node --loader ts-node/esm src/tools/import-json.ts <file> --db <path> [--dry-run] [--force]",
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const dbIdx = args.indexOf("--db");
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;
  const file = args.find((a) => !a.startsWith("-") && a !== dbPath);
  return { dryRun, force, file, dbPath };
}

function nowMs() {
  return Date.now();
}

async function main(): Promise<void> {
  const { dryRun, force, file, dbPath } = parseArgs();
  if (!file || !dbPath) {
    usage();
    console.error("Missing required arguments");
    process.exit(1);
  }

  const raw = await fs.readFile(file, "utf8");
  const data: TableRows = JSON.parse(raw);

  // Whitelist tables
  for (const key of Object.keys(data)) {
    if (!DOMAIN_TABLES.has(key)) {
      console.warn(`Skipping unknown table: ${key}`);
      delete (data as any)[key];
    }
  }

  const idMap = new Map<number, string>();

  // First pass: map numeric ids
  for (const rows of Object.values(data)) {
    for (const row of rows) {
      if (typeof row.id === "number") {
        const uuid = newUuidV7();
        idMap.set(row.id, uuid);
        row.id = uuid;
      }
    }
  }

  const now = nowMs();

  // Second pass: transform rows
  for (const [table, rows] of Object.entries(data)) {
    const byHH = new Map<string, any[]>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key.endsWith("_id") && typeof row[key] === "number") {
          const mapped = idMap.get(row[key]);
          if (mapped) row[key] = mapped;
        }
        if (TIMESTAMP_FIELDS.has(key) && row[key] !== undefined) {
          row[key] = toMs(row[key]) ?? null;
        }
      }

      if (row.created_at == null) row.created_at = now;
      if (row.updated_at == null) row.updated_at = row.created_at;

      if (row.document != null) {
        row.root_key = row.root_key ?? "appData";
        row.relative_path =
          row.relative_path ?? sanitizeRelativePath(String(row.document));
        delete row.document;
      }

      row.deleted_at = row.deleted_at ?? null;

      if (POSITION_TABLES.has(table)) {
        const hh = row.household_id ?? "";
        if (!byHH.has(hh)) byHH.set(hh, []);
        byHH.get(hh)!.push(row);
      }
    }

    if (POSITION_TABLES.has(table)) {
      for (const group of byHH.values()) {
        group.forEach((row, idx) => {
          if (!Number.isFinite(row.position)) row.position = idx;
        });
      }
    }
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const sentinel = db.prepare("SELECT value FROM settings WHERE key = ?").get(
    SENTINEL_KEY,
  );
  if (sentinel && !force) {
    console.error("Import already performed; sentinel present (use --force to override)");
    db.close();
    return;
  }

  const summary: Record<string, number> = {};

  const txn = db.transaction(() => {
    for (const [table, rows] of Object.entries(data)) {
      if (rows.length === 0) continue;
      const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
      const placeholders = cols.map(() => "?").join(",");
      const stmt = db.prepare(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
      );
      let count = 0;
      for (const row of rows) {
        const params = cols.map((c) => row[c] ?? null);
        if (!dryRun) stmt.run(params);
        count++;
      }
      summary[table] = count;
    }

    if (!dryRun) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(SENTINEL_KEY, new Date().toISOString());
    }
  });

  try {
    txn();
  } catch (e) {
    console.error("Import failed. Rolling back.");
    db.close();
    throw e;
  }

  db.close();

  for (const [table, count] of Object.entries(summary)) {
    console.log(`${table}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

