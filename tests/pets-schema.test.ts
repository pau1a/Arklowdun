import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const ROOT_SCHEMA = readFileSync(path.join(ROOT, "schema.sql"), "utf8");
const TAURI_SCHEMA = readFileSync(path.join(ROOT, "src-tauri", "schema.sql"), "utf8");

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\)\s*;/g, ");")
    .trim();
}

function extractCreateStatement(sql: string, table: string): string {
  const marker = `CREATE TABLE ${table}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`CREATE TABLE ${table} not found`);

  let depth = 0;
  let end = -1;
  for (let i = start; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        end = sql.indexOf(";", i);
        if (end === -1) end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`CREATE TABLE ${table} statement not terminated`);
  return normalizeSql(sql.slice(start, end + 1));
}

function createDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TAURI_SCHEMA);
  return db;
}

function resolveHouseholdTable(db: Database.Database): string {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('household','households') ORDER BY CASE name WHEN 'household' THEN 0 ELSE 1 END LIMIT 1"
    )
    .get() as { name?: string } | undefined;
  if (!row?.name) {
    throw new Error("Expected either household or households table to exist");
  }
  return row.name;
}

function insertHousehold(db: Database.Database, householdId: string): void {
  const tableName = resolveHouseholdTable(db);
  const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all();
  const values = new Map<string, unknown>();
  const now = Date.now();

  values.set("id", householdId);

  const setIfPresent = (name: string, value: unknown) => {
    if (columns.some((col) => col.name === name)) {
      values.set(name, value);
    }
  };

  setIfPresent("name", "Household");
  setIfPresent("is_default", 0);
  setIfPresent("created_at", now);
  setIfPresent("updated_at", now);
  setIfPresent("tz", "UTC");
  setIfPresent("color", "#FFFFFF");
  setIfPresent("deleted_at", null);

  for (const col of columns) {
    if (col.notnull === 1 && col.dflt_value === null && !values.has(col.name)) {
      throw new Error(`Household table column ${col.name} requires a value for inserts`);
    }
  }

  const keys = Array.from(values.keys());
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
  const stmt = db.prepare(sql);
  stmt.run(...keys.map((key) => values.get(key)));
}

test("pets schema stays aligned across sources", () => {
  const rootPets = extractCreateStatement(ROOT_SCHEMA, "pets");
  const tauriPets = extractCreateStatement(TAURI_SCHEMA, "pets");
  assert.equal(rootPets, tauriPets, "pets DDL should match in both schema files");

  assert.match(
    rootPets,
    /household_id TEXT NOT NULL REFERENCES (household|households)\(id\) ON DELETE CASCADE ON UPDATE CASCADE/,
    "pets household FK should target the household table",
  );
  assert.ok(
    rootPets.includes("position INTEGER NOT NULL DEFAULT 0"),
    "pets table should default position to 0",
  );

  const rootMedical = extractCreateStatement(ROOT_SCHEMA, "pet_medical");
  const tauriMedical = extractCreateStatement(TAURI_SCHEMA, "pet_medical");
  assert.equal(rootMedical, tauriMedical, "pet_medical DDL should match in both schema files");

  assert.match(
    rootMedical,
    /pet_id TEXT NOT NULL REFERENCES pets\(id\) ON DELETE CASCADE ON UPDATE CASCADE/,
    "pet_medical should cascade to pets",
  );
  assert.match(
    rootMedical,
    /household_id TEXT NOT NULL REFERENCES (household|households)\(id\) ON DELETE CASCADE ON UPDATE CASCADE/,
    "pet_medical household FK should target the household table",
  );
  assert.ok(
    rootMedical.includes("category TEXT NOT NULL DEFAULT 'pet_medical'"),
    "pet_medical category column should default to pet_medical",
  );
  const categoryCheckMatch = rootMedical.match(/CHECK\s*\(\s*category\s+IN\s*\(([^)]+)\)\)/i);
  assert.ok(categoryCheckMatch, "pet_medical category CHECK should exist");
  const categories = categoryCheckMatch![1]
    .split(",")
    .map((token) => token.replace(/['"`]/g, "").trim())
    .filter(Boolean);
  const expectedCategories = [
    "bills",
    "policies",
    "property_documents",
    "inventory_items",
    "pet_medical",
    "vehicles",
    "vehicle_maintenance",
    "notes",
    "misc",
  ];
  for (const category of expectedCategories) {
    assert.ok(
      categories.includes(category),
      `category CHECK should include ${category}`,
    );
  }
});

test("pets schema exposes expected columns and indexes", () => {
  const db = createDatabase();
  try {
    const petsColumns = db.prepare("PRAGMA table_info('pets')").all();
    const columnNames = petsColumns.map((col) => col.name);
    assert.deepEqual(columnNames, [
      "id",
      "name",
      "type",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "position",
    ]);

    const notNullColumns = petsColumns.filter((col) => col.notnull === 1).map((col) => col.name);
    assert.deepEqual(notNullColumns, ["name", "type", "household_id", "created_at", "updated_at", "position"]);

    const indexes = db.prepare("PRAGMA index_list('pets')").all();
    const filtered = indexes.filter((idx) => !idx.name.startsWith("sqlite_autoindex"));
    const indexNames = filtered.map((idx) => idx.name).sort();
    assert.deepEqual(indexNames, ["pets_household_position_idx", "pets_household_updated_idx"]);
    const positionIndex = filtered.find((idx) => idx.name === "pets_household_position_idx");
    assert(positionIndex, "pets_household_position_idx should exist");
    assert.equal(positionIndex?.unique, 1, "pets_household_position_idx should be UNIQUE");
    const positionIndexName = positionIndex?.name;
    assert(positionIndexName, "pets_household_position_idx should expose a name");
    const positionIndexSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(positionIndexName) as { sql?: string } | undefined;
    assert(positionIndexSql?.sql, "pets_household_position_idx should have CREATE INDEX sql");
    assert.match(
      positionIndexSql.sql!,
      /WHERE\s+deleted_at\s+IS\s+NULL/i,
      "pets_household_position_idx should be partial on deleted_at IS NULL",
    );
  } finally {
    db.close();
  }
});

test("pet_medical schema enforces cascade and integrity", () => {
  const db = createDatabase();
  try {
    const columns = db.prepare("PRAGMA table_info('pet_medical')").all();
    const columnNames = columns.map((col) => col.name);
    assert.deepEqual(columnNames, [
      "id",
      "pet_id",
      "date",
      "description",
      "document",
      "reminder",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
      "category",
    ]);

    const expectedDefaults = new Map<string, string | null>([
      ["category", "'pet_medical'"],
    ]);
    for (const col of columns) {
      if (expectedDefaults.has(col.name)) {
        assert.equal(col.dflt_value, expectedDefaults.get(col.name));
      }
    }

    const medicalIndexes = db.prepare("PRAGMA index_list('pet_medical')").all();
    const indexNames = medicalIndexes
      .map((idx) => idx.name)
      .filter((name) => !name.startsWith("sqlite_autoindex"))
      .sort();
    assert.deepEqual(indexNames, [
      "pet_medical_household_category_path_idx",
      "pet_medical_household_updated_idx",
      "pet_medical_pet_date_idx",
    ]);
    const categoryIndex = medicalIndexes.find((idx) => idx.name === "pet_medical_household_category_path_idx");
    assert(categoryIndex, "pet_medical_household_category_path_idx should exist");
    assert.equal(categoryIndex?.unique, 1, "pet_medical_household_category_path_idx should be UNIQUE");
    const categoryIndexName = categoryIndex?.name;
    assert(categoryIndexName, "pet_medical_household_category_path_idx should expose a name");
    const categoryIndexSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(categoryIndexName) as { sql?: string } | undefined;
    assert(categoryIndexSql?.sql, "pet_medical_household_category_path_idx should have CREATE INDEX sql");
    assert.match(
      categoryIndexSql.sql!,
      /WHERE\s+deleted_at\s+IS\s+NULL\s+AND\s+relative_path\s+IS\s+NOT\s+NULL/i,
      "pet_medical household/category/path index should enforce deleted_at IS NULL and relative_path IS NOT NULL",
    );

    const now = Date.now();
    const householdId = "hh_001";
    insertHousehold(db, householdId);

    const petId = "pet_001";
    db.prepare(
      "INSERT INTO pets (id, name, type, household_id, created_at, updated_at, position) VALUES (?, 'Skye', 'Dog', ?, ?, ?, 0)"
    ).run(petId, householdId, now, now);

    const insertMedical = db.prepare(
      "INSERT INTO pet_medical (id, pet_id, date, description, household_id, created_at, updated_at) VALUES (?, ?, ?, 'Checkup', ?, ?, ?)"
    );
    insertMedical.run("med_001", petId, now - 10, householdId, now - 10, now - 10);
    insertMedical.run("med_002", petId, now, householdId, now, now);

    const fkBefore = db.prepare("PRAGMA foreign_key_check").all();
    assert.equal(fkBefore.length, 0, "foreign_key_check should be clean after inserts");
    const integrityBefore = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    assert.equal(integrityBefore.integrity_check.toLowerCase(), "ok");

    const deleteResult = db.prepare("DELETE FROM pets WHERE id = ?").run(petId);
    assert.equal(deleteResult.changes, 1, "pet row should be deleted");

    const medicalCount = db
      .prepare("SELECT COUNT(*) AS count FROM pet_medical WHERE pet_id = ?")
      .get(petId) as { count: number };
    assert.equal(medicalCount.count, 0, "pet_medical rows should cascade delete");

    const fkAfter = db.prepare("PRAGMA foreign_key_check").all();
    assert.equal(fkAfter.length, 0, "foreign_key_check should remain clean after cascade");
    const integrityAfter = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    assert.equal(integrityAfter.integrity_check.toLowerCase(), "ok");
  } finally {
    db.close();
  }
});
