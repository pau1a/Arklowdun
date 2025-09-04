import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type * as BetterSqlite3 from "better-sqlite3";
type DB = BetterSqlite3.Database;
import { newUuidV7 } from "../db/id.ts";
import { toMs } from "../db/normalize.ts";
import { sanitizeRelativePath } from "../files/path.ts";

interface Args {
  dbPath: string;
  dir: string;
  household: string;
  dryRun: boolean;
}

function showUsage(): never {
  console.error(
    "Usage: node migrate-batch1 --db <path> [--dir <dir>] [--household <id>] [--dry-run]"
  );
  process.exit(1);
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let dbPath = "";
  let dir = ".";
  let household = "default";
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--db") dbPath = args[++i];
    else if (a === "--dir") dir = args[++i];
    else if (a === "--household") household = args[++i];
    else if (a === "--dry-run") dryRun = true;
    else showUsage();
  }
  if (!dbPath) showUsage();
  return { dbPath, dir, household, dryRun };
}

function readJson(file: string): any[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function uuidv5From(domain: string, hh: string, legacyId: string): string {
  const h = crypto
    .createHash("sha1")
    .update(`arklowdun:${domain}:${hh}:${legacyId}`)
    .digest();
  const b = Buffer.from(h);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20, 32)}`;
}

function commonFields(
  domain: "bills" | "policies" | "property_documents",
  row: any,
  hh: string,
  idx: number,
  now: number
) {
  const id =
    typeof row.id === "string"
      ? row.id
      : row.id != null
      ? uuidv5From(domain, hh, String(row.id))
      : newUuidV7();
  const created = toMs(row.created_at) ?? now;
  const updated = toMs(row.updated_at) ?? created;
  const position = Number.isFinite(row.position) ? row.position : idx;
  const reminder = toMs(row.reminder);
  const deleted_at = toMs(row.deleted_at ?? row.deletedAt);
  const root = row.root_key ?? (row.document ? "appData" : undefined);
  const rel =
    row.relative_path ??
    (row.document ? sanitizeRelativePath(String(row.document)) : undefined);
  return {
    id,
    created_at: created,
    updated_at: updated,
    position,
    reminder: reminder ?? null,
    deleted_at: deleted_at ?? null,
    root_key: rel ? (root ?? "appData") : null,
    relative_path: rel ?? null,
    household_id: row.household_id ?? hh,
  };
}

function toAmount(v: any): number {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") n = Number(v.replace(/[^\d.]/g, ""));
  else n = 0;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function resolveHousehold(db: DB, requested: string): string {
  if (requested !== "default") return requested;
  const row = db
    .prepare(
      "SELECT id FROM household WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 1"
    )
    .get() as { id?: string } | undefined;
  if (!row || !row.id) throw new Error("No household found in DB");
  return row.id as string;
}

function migrateBills(db: DB, dir: string, hh: string, dryRun: boolean) {
  const file = path.join(dir, "bills.json");
  const rows = readJson(file);
  if (!rows.length) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO bills (id, amount, due_date, root_key, relative_path, reminder, position, household_id, created_at, updated_at, deleted_at) VALUES (@id, @amount, @due_date, @root_key, @relative_path, @reminder, @position, @household_id, @created_at, @updated_at, @deleted_at) ON CONFLICT(id) DO NOTHING"
  );
  let count = 0;
  rows.forEach((r: any, idx: number) => {
    const due = toMs(r.due_date ?? r.dueDate);
    const base = commonFields("bills", r, hh, idx, now);
    if (base.deleted_at) return; // skip deleted
    const row = {
      ...base,
      amount: toAmount(r.amount),
      due_date: due ?? now,
    };
    if (!dryRun) stmt.run(row);
    count++;
  });
  return count;
}

function migratePolicies(db: DB, dir: string, hh: string, dryRun: boolean) {
  const file = path.join(dir, "policies.json");
  const rows = readJson(file);
  if (!rows.length) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO policies (id, amount, due_date, root_key, relative_path, reminder, position, household_id, created_at, updated_at, deleted_at) VALUES (@id, @amount, @due_date, @root_key, @relative_path, @reminder, @position, @household_id, @created_at, @updated_at, @deleted_at) ON CONFLICT(id) DO NOTHING"
  );
  let count = 0;
  rows.forEach((r: any, idx: number) => {
    const due = toMs(r.due_date ?? r.dueDate);
    const base = commonFields("policies", r, hh, idx, now);
    if (base.deleted_at) return;
    const row = {
      ...base,
      amount: toAmount(r.amount),
      due_date: due ?? now,
    };
    if (!dryRun) stmt.run(row);
    count++;
  });
  return count;
}

function migratePropertyDocs(db: DB, dir: string, hh: string, dryRun: boolean) {
  const file = path.join(dir, "property_documents.json");
  const rows = readJson(file);
  if (!rows.length) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO property_documents (id, description, renewal_date, root_key, relative_path, reminder, position, household_id, created_at, updated_at, deleted_at) VALUES (@id, @description, @renewal_date, @root_key, @relative_path, @reminder, @position, @household_id, @created_at, @updated_at, @deleted_at) ON CONFLICT(id) DO NOTHING"
  );
  let count = 0;
  rows.forEach((r: any, idx: number) => {
    const due = toMs(r.renewal_date ?? r.renewalDate);
    const base = commonFields("property_documents", r, hh, idx, now);
    if (base.deleted_at) return;
    const row = {
      ...base,
      description: String(r.description ?? ""),
      renewal_date: due ?? now,
    };
    if (!dryRun) stmt.run(row);
    count++;
  });
  return count;
}

async function main() {
  const { dbPath, dir, household, dryRun } = parseArgs();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  const hh = resolveHousehold(db, household);
  console.log(`household: ${hh}`);
  if (dryRun) console.log("dry-run mode: no changes will be written");
  const runBatch = db.transaction(() => ({
    bills: migrateBills(db, dir, hh, dryRun),
    policies: migratePolicies(db, dir, hh, dryRun),
    property_documents: migratePropertyDocs(db, dir, hh, dryRun),
  }));
  const counts = runBatch();
  db.close();
  for (const [k, v] of Object.entries(counts)) {
    console.log(`${k}: ${v}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

