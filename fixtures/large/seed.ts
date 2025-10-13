/* eslint-disable security/detect-object-injection -- fixture generator indexes controlled schema keys */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

interface Options {
  dbPath: string;
  attachmentsDir: string;
  seed: number;
  households: number;
  events: number;
  notes: number;
  attachments: number;
  reset: boolean;
  summaryPath?: string;
}

interface Household {
  id: string;
  name: string;
  tz: string;
}

interface AttachmentSource {
  diskName: string;
  displayName: string;
  absPath: string;
  size: number;
  kind: "small" | "medium";
}

interface EventStats {
  total: number;
  timed: number;
  allDay: number;
  recurring: number;
  multiDay: number;
  withReminder: number;
  softDeleted: number;
  restored: number;
  recurrence: {
    daily: number;
    weekly: number;
    monthly: number;
    until: number;
    count: number;
    byDay: number;
    byMonthDay: number;
    withExdates: number;
    withDuplicateExdates: number;
    dstEdge: number;
  };
}

interface NoteStats {
  total: number;
  softDeleted: number;
  restored: number;
  withDeadline: number;
}

interface AttachmentStats {
  total: number;
  byRootKey: Record<string, number>;
  bySourceKind: Record<AttachmentSource["kind"], number>;
  reusedLogicalFiles: number;
}

interface GenerationSummary {
  database: string;
  households: number;
  seed: number;
  events: EventStats;
  notes: NoteStats;
  attachments: AttachmentStats;
}

const DEFAULTS = {
  seed: 42,
  households: 3,
  events: 10_000,
  notes: 5_000,
  attachments: 300,
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function assertRatio(count: number, total: number, min: number, label: string): void {
  if (total === 0) {
    throw new Error(`Cannot evaluate ratio for ${label} with zero total`);
  }
  if (count / total < min) {
    throw new Error(`${label} ratio ${((count / total) * 100).toFixed(2)}% is below minimum ${(min * 100).toFixed(1)}%`);
  }
}

function assertPositive(value: number, label: string): void {
  if (value <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
}

function validateSummary(summary: GenerationSummary, opts: Options): void {
  if (summary.events.total !== opts.events) {
    throw new Error(`Expected ${opts.events} events, generated ${summary.events.total}`);
  }
  if (summary.notes.total !== opts.notes) {
    throw new Error(`Expected ${opts.notes} notes, generated ${summary.notes.total}`);
  }
  if (summary.attachments.total !== opts.attachments) {
    throw new Error(`Expected ${opts.attachments} attachments, generated ${summary.attachments.total}`);
  }

  assertRatio(summary.events.allDay, summary.events.total, 0.2, "All-day event");
  assertRatio(summary.events.recurring, summary.events.total, 0.1, "Recurring event");
  assertRatio(summary.events.softDeleted, summary.events.total, 0.05, "Soft-deleted event");
  assertRatio(summary.events.restored, summary.events.total, 0.02, "Restored event");

  if (summary.events.recurring > 0) {
    assertRatio(summary.events.recurrence.withExdates, summary.events.recurring, 0.05, "Recurring events with EXDATE");
  }
  assertPositive(summary.events.recurrence.withDuplicateExdates, "Duplicate EXDATE coverage");
  assertPositive(summary.events.recurrence.dstEdge, "DST edge recurrence coverage");
  assertPositive(summary.events.recurrence.until, "RRULE UNTIL coverage");
  assertPositive(summary.events.recurrence.count, "RRULE COUNT coverage");
  assertPositive(summary.events.recurrence.byDay, "RRULE BYDAY coverage");
  assertPositive(summary.events.recurrence.byMonthDay, "RRULE BYMONTHDAY coverage");

  assertRatio(summary.notes.softDeleted, summary.notes.total, 0.05, "Soft-deleted notes");
  assertRatio(summary.notes.restored, summary.notes.total, 0.02, "Restored notes");
  assertRatio(summary.notes.withDeadline, summary.notes.total, 0.25, "Notes with deadlines");

  assertPositive(summary.attachments.bySourceKind.small, "Small attachment coverage");
  assertPositive(summary.attachments.bySourceKind.medium, "Medium attachment coverage");
  assertPositive(summary.attachments.byRootKey.appData, "appData attachment coverage");
  assertPositive(summary.attachments.reusedLogicalFiles, "Attachment reuse coverage");
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let dbPath = path.resolve("arklowdun.sqlite3");
  let attachmentsDir: string | undefined;
  let seed = DEFAULTS.seed;
  let households = DEFAULTS.households;
  let events = DEFAULTS.events;
  let notes = DEFAULTS.notes;
  let attachments = DEFAULTS.attachments;
  let reset = false;
  let summaryPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--db":
        dbPath = path.resolve(args[++i] ?? "");
        break;
      case "--attachments":
        attachmentsDir = path.resolve(args[++i] ?? "");
        break;
      case "--seed":
        seed = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(seed)) throw new Error("--seed must be an integer");
        break;
      case "--households":
        households = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(households) || households < 2) {
          throw new Error("--households must be an integer >= 2");
        }
        break;
      case "--events":
        events = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(events) || events < 1) {
          throw new Error("--events must be positive");
        }
        break;
      case "--notes":
        notes = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(notes) || notes < 1) {
          throw new Error("--notes must be positive");
        }
        break;
      case "--attachments-count":
        attachments = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(attachments) || attachments < 1) {
          throw new Error("--attachments-count must be positive");
        }
        break;
      case "--summary": {
        const target = args[++i];
        if (!target) throw new Error("--summary requires a path");
        summaryPath = path.resolve(target);
        break;
      }
      case "--reset":
        reset = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: seed.ts [options]\n" +
            "  --db PATH              Absolute sqlite destination (default ./arklowdun.sqlite3)\n" +
            "  --attachments PATH     Attachments root (default <db dir>/attachments)\n" +
            "  --seed N               PRNG seed (default 42)\n" +
            "  --households N         Number of households (default 3, minimum 2)\n" +
            "  --events N             Number of events to generate (default 10000)\n" +
            "  --notes N              Number of notes to generate (default 5000)\n" +
            "  --attachments-count N  Number of attachment-backed rows (default 300)\n" +
            "  --summary PATH         Write the JSON summary to PATH in addition to stdout\n" +
            "  --reset                Remove existing database and attachments before seeding\n",
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!attachmentsDir) {
    attachmentsDir = path.resolve(path.dirname(dbPath), "attachments");
  }

  return {
    dbPath,
    attachmentsDir,
    seed,
    households,
    events,
    notes,
    attachments,
    reset,
    summaryPath,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomChoice<T>(rand: () => number, values: T[]): T {
  return values[Math.floor(rand() * values.length)];
}

function uuidLike(rand: () => number): string {
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += Math.floor(rand() * 16).toString(16);
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

function ensureDirectories(opts: Options): void {
  const dbDir = path.dirname(opts.dbPath);
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(opts.attachmentsDir, { recursive: true });
}

function resetTargets(opts: Options): void {
  if (opts.reset) {
    fs.rmSync(opts.dbPath, { force: true });
    fs.rmSync(opts.attachmentsDir, { recursive: true, force: true });
  }
}

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve("migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();

  let schemaTableExists = false;
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get() as { name?: string } | undefined;
    schemaTableExists = !!row;
  } catch {
    schemaTableExists = false;
  }

  const applied = new Set<string>();
  if (schemaTableExists) {
    try {
      const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: string }[];
      for (const row of rows) applied.add(row.version);
    } catch {
      // ignore
    }
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      const hasSchemaTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get() as { name?: string } | undefined;
      if (hasSchemaTable) {
        db.prepare("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(file, Date.now());
      }
    });
    tx();
  }
}

function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.length === 0) throw new Error(`Table ${table} not found`);
  return rows.map((row) => row.name);
}

function makeInserter(
  db: Database.Database,
  table: string,
  columns: string[],
  aliases: Record<string, string[]> = {},
) {
  const actualColumns = tableColumns(db, table);
  const chosen: string[] = [];
  const columnMap: Record<string, string> = {};

  for (const requested of columns) {
    if (actualColumns.includes(requested) && !chosen.includes(requested)) {
      chosen.push(requested);
      columnMap[requested] = requested;
      continue;
    }
    const alts = aliases[requested] ?? [];
    const match = alts.find((alt) => actualColumns.includes(alt) && !chosen.includes(alt));
    if (match) {
      chosen.push(match);
      columnMap[match] = requested;
    }
  }

  if (chosen.length === 0) {
    throw new Error(`No usable columns for ${table}`);
  }

  const placeholders = chosen.map(() => "?").join(",");
  const sql = `INSERT INTO ${table} (${chosen.join(",")}) VALUES (${placeholders})`;
  const stmt = db.prepare(sql);
  return (values: Record<string, any>) => {
    const args = chosen.map((col) => values[columnMap[col]]);
    stmt.run(...args);
  };
}

function alignToDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function formatIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

function generateHouseholds(db: Database.Database, rand: () => number, count: number): Household[] {
  const insertHousehold = makeInserter(db, "household", ["id", "name", "created_at", "updated_at", "deleted_at", "tz"], {
    tz: ["tz"],
  });
  const tzOptions = [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "Europe/Dublin",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  const base = Date.UTC(2023, 0, 1);
  const households: Household[] = [];

  const run = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `hh_${String(i + 1).padStart(2, "0")}`;
      const created = base + i * DAY_MS;
      const tz = randomChoice(rand, tzOptions);
      insertHousehold({
        id,
        name: `Roundtrip Household ${i + 1}`,
        created_at: created,
        updated_at: created + HOUR_MS,
        deleted_at: null,
        tz,
      });
      households.push({ id, name: `Roundtrip Household ${i + 1}`, tz });
    }
  });

  run();

  return households;
}

function generateEvents(
  db: Database.Database,
  households: Household[],
  rand: () => number,
  total: number,
): EventStats {
  const insertEvent = makeInserter(
    db,
    "events",
    [
      "id",
      "title",
      "tz",
      "start_at_utc",
      "end_at_utc",
      "rrule",
      "exdates",
      "reminder",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    {
      deleted_at: ["deleted_at"],
    },
  );

  const tzOptions = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Europe/Berlin",
    "Europe/Dublin",
    "Asia/Tokyo",
    "Asia/Kolkata",
    "Australia/Sydney",
  ];

  const base = Date.UTC(2024, 0, 1);
  const typeCycle = ["timed", "all-day", "recurring", "multi-day"] as const;
  const typeOptions = [...typeCycle];
  const stats: EventStats = {
    total,
    timed: 0,
    allDay: 0,
    recurring: 0,
    multiDay: 0,
    withReminder: 0,
    softDeleted: 0,
    restored: 0,
    recurrence: {
      daily: 0,
      weekly: 0,
      monthly: 0,
      until: 0,
      count: 0,
      byDay: 0,
      byMonthDay: 0,
      withExdates: 0,
      withDuplicateExdates: 0,
      dstEdge: 0,
    },
  };

  const softDeleted: { id: string; restoreAt: number }[] = [];

  const run = db.transaction(() => {
    for (let i = 0; i < total; i++) {
      const household = households[i % households.length];
      const baseType = typeCycle[i % typeCycle.length];
      const type = rand() < 0.1 ? randomChoice(rand, typeOptions) : baseType;
      const eventId = `evt_${String(i + 1).padStart(6, "0")}`;

      let tz = randomChoice(rand, tzOptions);
      const startDayOffset = i - Math.floor(total / 2);
      const dayStart = alignToDay(base + startDayOffset * DAY_MS);
      let startMs =
        type === "all-day"
          ? dayStart
          : dayStart + randomInt(rand, 0, 18) * HOUR_MS + randomInt(rand, 0, 45) * 60_000;

      let endMs = startMs + HOUR_MS;
      let rrule: string | null = null;
      let exdates: string | null = null;
      let hasDuplicateExdate = false;

      switch (type) {
        case "timed":
          stats.timed++;
          endMs = startMs + randomInt(rand, 1, 4) * HOUR_MS;
          break;
        case "all-day":
          stats.allDay++;
          endMs = startMs + DAY_MS;
          break;
        case "recurring": {
          stats.recurring++;
          const freqOptions = ["DAILY", "WEEKLY", "MONTHLY"] as const;
          type Freq = (typeof freqOptions)[number];
          let effectiveFreq: Freq = freqOptions[(i + stats.recurring) % freqOptions.length];
          let interval = effectiveFreq === "MONTHLY" ? randomInt(rand, 1, 2) : randomInt(rand, 1, 4);

          if (stats.recurrence.dstEdge === 0) {
            tz = "America/New_York";
            startMs = Date.UTC(2024, 2, 10, 6, 0); // DST transition day
            effectiveFreq = "DAILY";
            interval = 1;
            stats.recurrence.dstEdge++;
          }

          const useUntil = (i + 3) % 5 === 0;
          const rruleParts = [`FREQ=${effectiveFreq}`, `INTERVAL=${interval}`];

          if (useUntil) {
            const untilSpan =
              effectiveFreq === "DAILY"
                ? randomInt(rand, 25, 90) * DAY_MS
                : effectiveFreq === "WEEKLY"
                ? randomInt(rand, 8, 26) * 7 * DAY_MS
                : randomInt(rand, 6, 18) * 30 * DAY_MS;
            rruleParts.push(`UNTIL=${formatIso(startMs + untilSpan)}`);
            stats.recurrence.until++;
          } else {
            const count = randomInt(rand, 10, 40);
            rruleParts.push(`COUNT=${count}`);
            stats.recurrence.count++;
          }

          if (effectiveFreq === "DAILY") stats.recurrence.daily++;
          if (effectiveFreq === "WEEKLY") stats.recurrence.weekly++;
          if (effectiveFreq === "MONTHLY") stats.recurrence.monthly++;

          if (effectiveFreq !== "MONTHLY") {
            const bydayOptions = [
              "MO",
              "TU",
              "WE",
              "TH",
              "FR",
              "SA",
              "SU",
              "MO,WE,FR",
              "TU,TH",
              "SA,SU",
            ];
            const byday = bydayOptions[(i + interval) % bydayOptions.length];
            rruleParts.push(`BYDAY=${byday}`);
            stats.recurrence.byDay++;
          } else {
            const monthDay = randomInt(rand, 1, 28);
            rruleParts.push(`BYMONTHDAY=${monthDay}`);
            stats.recurrence.byMonthDay++;
          }

          endMs = startMs + randomInt(rand, 1, 3) * HOUR_MS;
          if ((stats.recurring % 3 === 0 || rand() < 0.4) && stats.recurrence.withExdates < stats.recurring) {
            const skipCount = randomInt(rand, 1, 3);
            const points = new Set<string>();
            for (let j = 0; j < skipCount; j++) {
              const offsetDays = randomInt(rand, 1, 6 + j * 2);
              points.add(formatIso(startMs + offsetDays * DAY_MS));
            }
            const exdateList = Array.from(points);
            if (stats.recurrence.withDuplicateExdates === 0 && exdateList.length > 0) {
              exdateList.push(exdateList[0]);
              hasDuplicateExdate = true;
            } else if (rand() < 0.2 && exdateList.length > 0) {
              exdateList.push(exdateList[randomInt(rand, 0, exdateList.length - 1)]);
              hasDuplicateExdate = true;
            }
            exdates = exdateList.join(",");
            stats.recurrence.withExdates++;
            if (hasDuplicateExdate) stats.recurrence.withDuplicateExdates++;
          }

          rrule = rruleParts.join(";");
          break;
        }
        case "multi-day":
          stats.multiDay++;
          endMs = startMs + randomInt(rand, 2, 5) * DAY_MS;
          break;
      }

      const createdAt = startMs - randomInt(rand, 1, 14) * DAY_MS;
      const updatedAt = createdAt + randomInt(rand, 1, 5) * DAY_MS + randomInt(rand, 0, 12) * HOUR_MS;
      const reminder = rand() < 0.45 ? startMs - randomInt(rand, 15, 240) * 60_000 : null;
      if (reminder) stats.withReminder++;
      const deletedAt = rand() < 0.1 ? updatedAt + randomInt(rand, 1, 5) * DAY_MS : null;
      if (deletedAt) {
        softDeleted.push({ id: eventId, restoreAt: deletedAt + randomInt(rand, 1, 5) * DAY_MS });
      }

      insertEvent({
        id: eventId,
        title: `${type.replace(/-/g, " ")} event #${i + 1}`,
        tz,
        start_at_utc: startMs,
        end_at_utc: endMs,
        rrule,
        exdates,
        reminder,
        household_id: household.id,
        created_at: createdAt,
        updated_at: Math.max(updatedAt, createdAt),
        deleted_at: deletedAt,
      });
    }
  });

  run();

  const totalSoftDeleted = softDeleted.length;
  const restoreTarget = Math.min(Math.max(1, Math.floor(total * 0.03)), totalSoftDeleted);
  const restoreBatch = softDeleted.slice(0, restoreTarget);
  const stillSoftDeleted = totalSoftDeleted - restoreBatch.length;

  if (restoreBatch.length > 0) {
    const update = db.prepare("UPDATE events SET deleted_at = NULL, updated_at = ? WHERE id = ?");
    const restoreTx = db.transaction(() => {
      for (const item of restoreBatch) {
        update.run(item.restoreAt, item.id);
      }
    });
    restoreTx();
  }

  stats.softDeleted = stillSoftDeleted;
  stats.restored = restoreBatch.length;

  return stats;
}

const CATEGORY_DEFINITIONS = [
  { slug: "primary", name: "Primary", color: "#4F46E5" },
  { slug: "secondary", name: "Secondary", color: "#1D4ED8" },
  { slug: "tasks", name: "Tasks", color: "#0EA5E9" },
  { slug: "bills", name: "Bills", color: "#F59E0B" },
  { slug: "insurance", name: "Insurance", color: "#EA580C" },
  { slug: "property", name: "Property", color: "#F97316" },
  { slug: "vehicles", name: "Vehicles", color: "#22C55E" },
  { slug: "pets", name: "Pets", color: "#16A34A" },
  { slug: "family", name: "Family", color: "#EF4444" },
  { slug: "inventory", name: "Inventory", color: "#C026D3" },
  { slug: "budget", name: "Budget", color: "#A855F7" },
  { slug: "shopping", name: "Shopping", color: "#6366F1" },
];

const NOTE_COLORS = ["#FFF4B8", "#FFFF88", "#CFF7E3", "#DDEBFF", "#FFD9D3", "#EADCF9", "#F6EBDC"];

interface SeedCategory {
  id: string;
  slug: string;
  position: number;
}

function generateCategories(
  db: Database.Database,
  households: Household[],
): Record<string, SeedCategory[]> {
  const insertCategory = makeInserter(
    db,
    "categories",
    [
      "id",
      "household_id",
      "name",
      "slug",
      "color",
      "position",
      "z",
      "is_visible",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  );

  const categoriesByHousehold: Record<string, SeedCategory[]> = {};
  const baseCreated = Date.UTC(2023, 0, 1);

  const run = db.transaction(() => {
    households.forEach((household) => {
      const entries: SeedCategory[] = [];
      CATEGORY_DEFINITIONS.forEach((definition, index) => {
        const id = `cat_${household.id}_${definition.slug}`;
        const createdAt = baseCreated + index * HOUR_MS;
        insertCategory({
          id,
          household_id: household.id,
          name: definition.name,
          slug: definition.slug,
          color: definition.color,
          position: index,
          z: 0,
          is_visible: 1,
          created_at: createdAt,
          updated_at: createdAt,
          deleted_at: null,
        });
        entries.push({ id, slug: definition.slug, position: index });
      });
      categoriesByHousehold[household.id] = entries;
    });
  });

  run();

  return categoriesByHousehold;
}

function generateNotes(
  db: Database.Database,
  households: Household[],
  rand: () => number,
  total: number,
  categoriesByHousehold: Record<string, SeedCategory[]>,
): NoteStats {
  const insertNote = makeInserter(
    db,
    "notes",
    [
      "id",
      "household_id",
      "category_id",
      "text",
      "color",
      "x",
      "y",
      "z",
      "position",
      "created_at",
      "updated_at",
      "deleted_at",
      "deadline",
      "deadline_tz",
    ],
    {
      text: ["text", "body", "content"],
      color: ["color"],
      x: ["x"],
      y: ["y"],
      z: ["z", "z_index"],
      position: ["position"],
      deadline: ["deadline"],
      deadline_tz: ["deadline_tz", "deadline_timezone", "deadline_tz_name"],
    },
  );

  const perHousehold: Record<string, { position: number; z: number; categoryCursor: number }> = {};
  households.forEach((hh) => {
    perHousehold[hh.id] = { position: 0, z: 0, categoryCursor: 0 };
  });

  const stats: NoteStats = {
    total,
    softDeleted: 0,
    restored: 0,
    withDeadline: 0,
  };
  const softDeleted: { id: string; restoreAt: number }[] = [];

  const run = db.transaction(() => {
    for (let i = 0; i < total; i++) {
      const household = households[i % households.length];
      const tracker = perHousehold[household.id];
      const availableCategories = categoriesByHousehold[household.id] ?? [];
      const createdAt = Date.UTC(2024, 0, 1) + randomInt(rand, -120, 120) * DAY_MS;
      const updatedAt = createdAt + randomInt(rand, 0, 14) * DAY_MS + randomInt(rand, 0, 8) * HOUR_MS;
      const hasDeadline = rand() < 0.35;
      if (hasDeadline) stats.withDeadline++;
      const deadline = hasDeadline ? createdAt + randomInt(rand, 1, 30) * DAY_MS : null;
      const noteId = `note_${String(i + 1).padStart(5, "0")}`;
      const deletedAt = rand() < 0.12 ? updatedAt + randomInt(rand, 1, 10) * DAY_MS : null;
      if (deletedAt) {
        softDeleted.push({ id: noteId, restoreAt: deletedAt + randomInt(rand, 1, 5) * DAY_MS });
      }

      let categoryId: string | null = null;
      if (availableCategories.length > 0) {
        const shouldAssign = tracker.position % 2 === 0 || rand() < 0.35;
        if (shouldAssign) {
          const cursor = tracker.categoryCursor % availableCategories.length;
          categoryId = availableCategories[cursor].id;
          tracker.categoryCursor = (cursor + 1) % availableCategories.length;
        }
      }

      insertNote({
        id: noteId,
        household_id: household.id,
        category_id: categoryId,
        text: `Sticky note ${i + 1} for ${household.name}`,
        color: randomChoice(rand, NOTE_COLORS),
        x: randomInt(rand, 0, 600),
        y: randomInt(rand, 0, 400),
        z: tracker.z++,
        position: tracker.position++,
        created_at: createdAt,
        updated_at: Math.max(updatedAt, createdAt),
        deleted_at: deletedAt,
        deadline,
        deadline_tz: hasDeadline ? household.tz : null,
      });
    }
  });

  run();

  const totalSoftDeleted = softDeleted.length;
  const restoreTarget = Math.min(Math.max(1, Math.floor(total * 0.04)), totalSoftDeleted);
  const restoreBatch = softDeleted.slice(0, restoreTarget);
  const stillSoftDeleted = totalSoftDeleted - restoreBatch.length;

  if (restoreBatch.length > 0) {
    const update = db.prepare("UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?");
    const restoreTx = db.transaction(() => {
      for (const item of restoreBatch) {
        update.run(item.restoreAt, item.id);
      }
    });
    restoreTx();
  }

  stats.softDeleted = stillSoftDeleted;
  stats.restored = restoreBatch.length;

  return stats;
}

function loadAttachmentCorpus(): AttachmentSource[] {
  const corpusDir = path.resolve("fixtures", "large", "attachments");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(corpusDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(`Attachment corpus directory missing at ${corpusDir}`);
    }
    throw error;
  }

  const files = entries.filter((entry) => entry.isFile());
  if (files.length === 0) throw new Error("fixtures/large/attachments is empty");

  const sources = files
    .map((entry) => {
      const diskName = entry.name;
      const displayName = diskName.normalize("NFC");
      const absPath = path.join(corpusDir, diskName);
      const stat = fs.statSync(absPath);
      const kind: AttachmentSource["kind"] = stat.size <= 100_000 ? "small" : "medium";
      return { diskName, displayName, absPath, size: stat.size, kind };
    })
    // Use locale-independent, codepoint-based sorting for determinism across OS/ICU versions
    .sort((a, b) => {
      if (a.displayName < b.displayName) return -1;
      if (a.displayName > b.displayName) return 1;
      if (a.diskName < b.diskName) return -1;
      if (a.diskName > b.diskName) return 1;
      return 0;
    });

  return sources;
}

function copyAttachment(
  source: AttachmentSource,
  rootKey: "attachments" | "appData",
  relativePath: string,
  opts: Options,
) {
  const base = rootKey === "attachments" ? opts.attachmentsDir : path.dirname(opts.dbPath);
  const dest = path.join(base, relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source.absPath, dest);
}

function deterministicAttachmentSource(key: string, sources: AttachmentSource[]): AttachmentSource {
  const hash = crypto.createHash("sha256").update(key).digest();
  const index = hash.readUInt32BE(0) % sources.length;
  return sources[index];
}

function chooseRootKey(key: string): "attachments" | "appData" {
  const hash = crypto.createHash("sha256").update(`root:${key}`).digest();
  return hash[0] < 196 ? "attachments" : "appData";
}

function sanitizeSegment(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[^\p{L}0-9._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function generateSupportingRecords(
  db: Database.Database,
  households: Household[],
  rand: () => number,
) {
  const insertVehicle = makeInserter(
    db,
    "vehicles",
    [
      "id",
      "household_id",
      "name",
      "position",
      "make",
      "model",
      "trim",
      "model_year",
      "colour_primary",
      "colour_secondary",
      "body_type",
      "doors",
      "seats",
      "transmission",
      "drivetrain",
      "fuel_type_primary",
      "fuel_type_secondary",
      "engine_cc",
      "engine_kw",
      "emissions_co2_gkm",
      "euro_emissions_standard",
      "mot_date",
      "service_date",
      "mot_reminder",
      "service_reminder",
      "mot_last_date",
      "mot_expiry_date",
      "ved_expiry_date",
      "insurance_provider",
      "insurance_policy_number",
      "insurance_start_date",
      "insurance_end_date",
      "breakdown_provider",
      "breakdown_expiry_date",
      "ownership_status",
      "purchase_date",
      "purchase_price",
      "seller_name",
      "seller_notes",
      "odometer_at_purchase",
      "finance_lender",
      "finance_agreement_number",
      "finance_monthly_payment",
      "lease_start_date",
      "lease_end_date",
      "contract_mileage_limit",
      "sold_date",
      "sold_price",
      "odometer_unit",
      "odometer_current",
      "odometer_updated_at",
      "service_interval_miles",
      "service_interval_months",
      "last_service_date",
      "next_service_due_date",
      "next_service_due_miles",
      "cambelt_due_date",
      "cambelt_due_miles",
      "brake_fluid_due_date",
      "coolant_due_date",
      "tyre_size_front",
      "tyre_size_rear",
      "tyre_pressure_front_psi",
      "tyre_pressure_rear_psi",
      "oil_grade",
      "next_mot_due",
      "next_service_due",
      "next_ved_due",
      "next_insurance_due",
      "primary_driver_id",
      "additional_driver_ids",
      "key_count",
      "has_spare_key",
      "hero_image_path",
      "default_attachment_root_key",
      "default_attachment_folder_relpath",
      "status",
      "tags",
      "notes",
      "reg",
      "vin",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    {
      mot_date: ["mot_date", "next_mot_due"],
      service_date: ["service_date", "next_service_due"],
    },
  );

  const insertPet = makeInserter(
    db,
    "pets",
    ["id", "name", "type", "household_id", "position", "created_at", "updated_at", "deleted_at"],
  );

  const vehicles: string[] = [];
  const pets: string[] = [];

  const run = db.transaction(() => {
    households.forEach((household, hhIndex) => {
      for (let i = 0; i < 8; i++) {
        const id = `veh_${household.id}_${String(i + 1).padStart(2, "0")}`;
        const includeReg = i % 3 !== 0;
        const includeVin = i % 4 !== 0;
        const motDate = Date.UTC(2023, 0, 1) + randomInt(rand, 0, 365) * DAY_MS;
        const serviceDate = Date.UTC(2023, 0, 1) + randomInt(rand, 0, 365) * DAY_MS;
        const purchaseDate = Date.UTC(2022, 0, 1) + randomInt(rand, 0, 365) * DAY_MS;
        const leaseStart = Date.UTC(2023, 0, 1) + randomInt(rand, 0, 180) * DAY_MS;
        const ownershipStatus = i % 4 === 0 ? "leased" : i % 5 === 0 ? "fleet" : "owned";
        const status = i % 6 === 0 ? "archived" : i % 7 === 0 ? "sold" : "active";
        const odometer = 10_000 + randomInt(rand, 0, 25_000);
        const odometerUnit = i % 5 === 0 ? "km" : "mi";
        const vinBase = uuidLike(rand).replace(/-/g, "").toUpperCase();
        const vin = includeVin ? vinBase.slice(0, 17).padEnd(17, "X") : null;
        const reg = includeReg ? `REG-${hhIndex + 1}-${i + 1}` : null;
        const leaseEnd = ownershipStatus === "leased" ? leaseStart + 365 * DAY_MS : null;
        const soldDate = status === "sold" ? Date.UTC(2024, 5, 1) + i * DAY_MS : null;
        const soldPrice = soldDate ? 12_500_00 + randomInt(rand, 0, 5_000_00) : null;
        insertVehicle({
          id,
          household_id: household.id,
          name: `${household.name} Vehicle ${i + 1}`,
          position: i,
          make: randomChoice(rand, ["Ford", "Honda", "Toyota", "BMW", "Audi", "Tesla"]),
          model: randomChoice(rand, ["S", "LX", "GT", "Touring", "CX", "Pro"]),
          trim: randomChoice(rand, ["Base", "Limited", "Sport", "Executive"]),
          model_year: 2015 + randomInt(rand, 0, 9),
          colour_primary: randomChoice(rand, ["Blue", "Red", "White", "Grey", "Black"]),
          colour_secondary: rand() < 0.5 ? randomChoice(rand, ["Black", "Silver", "White", null]) : null,
          body_type: randomChoice(rand, ["Hatchback", "SUV", "Saloon", "Estate"]),
          doors: randomChoice(rand, [3, 4, 5]),
          seats: randomChoice(rand, [4, 5, 7]),
          transmission: randomChoice(rand, ["manual", "automatic"]),
          drivetrain: randomChoice(rand, ["FWD", "RWD", "AWD"]),
          fuel_type_primary: randomChoice(rand, ["petrol", "diesel", "electric", "hybrid"]),
          fuel_type_secondary: rand() < 0.2 ? "electric" : null,
          engine_cc: randomInt(rand, 1000, 3000),
          engine_kw: randomInt(rand, 70, 300),
          emissions_co2_gkm: randomInt(rand, 80, 220),
          euro_emissions_standard: randomChoice(rand, ["EURO 5", "EURO 6"]),
          mot_date: motDate,
          service_date: serviceDate,
          mot_reminder: rand() < 0.3 ? motDate - randomInt(rand, 7, 21) * DAY_MS : null,
          service_reminder: rand() < 0.3 ? serviceDate - randomInt(rand, 7, 30) * DAY_MS : null,
          mot_last_date: motDate - 365 * DAY_MS,
          mot_expiry_date: motDate + 365 * DAY_MS,
          ved_expiry_date: Date.UTC(2024, 0, 1) + randomInt(rand, 30, 365) * DAY_MS,
          insurance_provider: randomChoice(rand, ["Direct Line", "Aviva", "LV="]),
          insurance_policy_number: `POL-${hhIndex + 1}-${i + 1}`,
          insurance_start_date: Date.UTC(2023, 6, 1),
          insurance_end_date: Date.UTC(2024, 5, 30),
          breakdown_provider: randomChoice(rand, ["AA", "RAC", "Green Flag"]),
          breakdown_expiry_date: Date.UTC(2024, 3, 1) + randomInt(rand, 0, 120) * DAY_MS,
          ownership_status,
          purchase_date: purchaseDate,
          purchase_price: 12_000_00 + randomInt(rand, 0, 8_000_00),
          seller_name: randomChoice(rand, ["Autohaus", "Main Street Motors", "Trusted Dealer"]),
          seller_notes: "Fixture vehicle purchase entry.",
          odometer_at_purchase: 5_000 + randomInt(rand, 0, 5_000),
          finance_lender: ownershipStatus === "owned" ? "NatWest" : "LeasePlan",
          finance_agreement_number: ownershipStatus === "owned" ? `FIN-${id}` : `LEASE-${id}`,
          finance_monthly_payment: ownershipStatus === "leased" ? 450_00 : 0,
          lease_start_date: ownershipStatus === "leased" ? leaseStart : null,
          lease_end_date: leaseEnd,
          contract_mileage_limit: ownershipStatus === "leased" ? 18_000 : null,
          sold_date,
          sold_price,
          odometer_unit: odometerUnit,
          odometer_current: odometer,
          odometer_updated_at: Date.UTC(2024, 4, 1),
          service_interval_miles: 10_000,
          service_interval_months: 12,
          last_service_date: serviceDate - 180 * DAY_MS,
          next_service_due_date: serviceDate + 365 * DAY_MS,
          next_service_due_miles: odometer + 10_000,
          cambelt_due_date: Date.UTC(2025, 0, 1) + randomInt(rand, 0, 365) * DAY_MS,
          cambelt_due_miles: odometer + 40_000,
          brake_fluid_due_date: Date.UTC(2024, 8, 1),
          coolant_due_date: Date.UTC(2024, 10, 1),
          tyre_size_front: "225/45 R17",
          tyre_size_rear: "225/45 R17",
          tyre_pressure_front_psi: 36,
          tyre_pressure_rear_psi: 34,
          oil_grade: randomChoice(rand, ["5W-30", "0W-20"]),
          next_mot_due: motDate + 365 * DAY_MS,
          next_service_due: serviceDate + 365 * DAY_MS,
          next_ved_due: Date.UTC(2024, 6, 1) + randomInt(rand, 0, 60) * DAY_MS,
          next_insurance_due: Date.UTC(2024, 5, 30),
          primary_driver_id: `driver_${household.id}`,
          additional_driver_ids: JSON.stringify([`driver_${household.id}_2`, `driver_${household.id}_3`]),
          key_count: 2,
          has_spare_key: i % 2 === 0,
          hero_image_path: `images/${id}.jpg`,
          default_attachment_root_key: "attachments",
          default_attachment_folder_relpath: `vehicles/${id}`,
          status,
          tags: JSON.stringify(["fleet", i % 2 === 0 ? "daily" : "spare"]),
          notes: "Large fixture data row for Vehicles module.",
          reg,
          vin,
          created_at: Date.UTC(2023, 0, 1),
          updated_at: Date.UTC(2024, 0, 1),
          deleted_at: rand() < 0.05 ? Date.UTC(2024, 6, 1) : null,
        });
        vehicles.push(id);
      }

      for (let i = 0; i < 10; i++) {
        const id = `pet_${household.id}_${String(i + 1).padStart(2, "0")}`;
        insertPet({
          id,
          name: randomChoice(rand, ["Milo", "Bella", "Charlie", "Luna", "Oliver", "Nala", "Max", "Coco"]),
          type: randomChoice(rand, ["Dog", "Cat", "Bird", "Hamster", "Rabbit"]),
          household_id: household.id,
          position: i,
          created_at: Date.UTC(2023, 5, 1),
          updated_at: Date.UTC(2024, 0, 1),
          deleted_at: rand() < 0.04 ? Date.UTC(2024, 7, 1) : null,
        });
        pets.push(id);
      }
    });
  });

  run();

  return { vehicles, pets };
}

function generateAttachments(
  db: Database.Database,
  households: Household[],
  rand: () => number,
  opts: Options,
  target: number,
  sources: AttachmentSource[],
  supporting: { vehicles: string[]; pets: string[] },
): AttachmentStats {
  const insertBill = makeInserter(
    db,
    "bills",
    [
      "id",
      "amount",
      "due_date",
      "reminder",
      "position",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
    ],
  );

  const insertPolicy = makeInserter(
    db,
    "policies",
    [
      "id",
      "amount",
      "due_date",
      "reminder",
      "position",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
    ],
  );

  const insertProperty = makeInserter(
    db,
    "property_documents",
    [
      "id",
      "description",
      "renewal_date",
      "reminder",
      "position",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
    ],
  );

  const insertInventory = makeInserter(
    db,
    "inventory_items",
    [
      "id",
      "name",
      "purchase_date",
      "warranty_expiry",
      "reminder",
      "position",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
    ],
  );

  const insertVehicleMaint = makeInserter(
    db,
    "vehicle_maintenance",
    [
      "id",
      "vehicle_id",
      "type",
      "date",
      "cost",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
    ],
  );

  const insertPetMedical = makeInserter(
    db,
    "pet_medical",
    [
      "id",
      "pet_id",
      "date",
      "description",
      "reminder",
      "household_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "root_key",
      "relative_path",
    ],
  );

  const perHousehold = Math.max(1, Math.floor(target / households.length));
  let generated = 0;
  let globalIndex = 0;
  const sourceUsage = new Map<string, number>();
  const stats: AttachmentStats = {
    total: 0,
    byRootKey: { attachments: 0, appData: 0 },
    bySourceKind: { small: 0, medium: 0 },
    reusedLogicalFiles: 0,
  };

  const run = db.transaction(() => {
    for (const household of households) {
      const basePosition = { bills: 0, policies: 0, property: 0, inventory: 0, vehicle: 0, pet: 0 };
      const hhTarget = household === households[households.length - 1] ? target - generated : perHousehold;

      const tableCycle = ["bill", "policy", "property", "inventory", "vehicle", "pet"] as const;

      for (let i = 0; i < hhTarget && generated < target; i++) {
        const logicalIndex = globalIndex++;
        const type = tableCycle[i % tableCycle.length];
        const logicalKey = `${household.id}:${type}:${logicalIndex}`;
        const source = deterministicAttachmentSource(logicalKey, sources);
        const rootKey = chooseRootKey(logicalKey);
        const relBase = `${sanitizeSegment(household.id)}/${type}/${String(logicalIndex).padStart(4, "0")}`;
        const cleanName = sanitizeSegment(source.displayName);
        const relativePath = `${relBase}-${cleanName}`;
        copyAttachment(source, rootKey, relativePath, opts);

        stats.total++;
        stats.byRootKey[rootKey] = (stats.byRootKey[rootKey] ?? 0) + 1;
        stats.bySourceKind[source.kind] = (stats.bySourceKind[source.kind] ?? 0) + 1;
        sourceUsage.set(source.diskName, (sourceUsage.get(source.diskName) ?? 0) + 1);

        const createdAt = Date.UTC(2024, 0, 1) + randomInt(rand, -90, 90) * DAY_MS;
        const updatedAt = createdAt + randomInt(rand, 0, 30) * DAY_MS;
        const deletedAt = rand() < 0.07 ? updatedAt + randomInt(rand, 1, 30) * DAY_MS : null;

        switch (type) {
          case "bill":
            insertBill({
              id: `bill_${household.id}_${String(basePosition.bills).padStart(4, "0")}`,
            amount: randomInt(rand, 2_500, 12_500),
            due_date: Date.UTC(2024, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            reminder: rand() < 0.4 ? Date.UTC(2024, 0, 1) + randomInt(rand, 1, 20) * DAY_MS : null,
            position: basePosition.bills++,
            household_id: household.id,
            created_at: createdAt,
            updated_at: Math.max(updatedAt, createdAt),
            deleted_at: deletedAt,
            root_key: rootKey,
            relative_path: relativePath,
          });
          break;
        case "policy":
          insertPolicy({
            id: `policy_${household.id}_${String(basePosition.policies).padStart(4, "0")}`,
            amount: randomInt(rand, 15_000, 65_000),
            due_date: Date.UTC(2024, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            reminder: rand() < 0.45 ? Date.UTC(2024, 0, 1) + randomInt(rand, 5, 40) * DAY_MS : null,
            position: basePosition.policies++,
            household_id: household.id,
            created_at: createdAt,
            updated_at: Math.max(updatedAt, createdAt),
            deleted_at: deletedAt,
            root_key: rootKey,
            relative_path: relativePath,
          });
          break;
        case "property":
          insertProperty({
            id: `prop_${household.id}_${String(basePosition.property).padStart(4, "0")}`,
            description: `${household.name} document ${basePosition.property + 1}`,
            renewal_date: Date.UTC(2025, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            reminder: rand() < 0.5 ? Date.UTC(2025, 0, 1) + randomInt(rand, 1, 60) * DAY_MS : null,
            position: basePosition.property++,
            household_id: household.id,
            created_at: createdAt,
            updated_at: Math.max(updatedAt, createdAt),
            deleted_at: deletedAt,
            root_key: rootKey,
            relative_path: relativePath,
          });
          break;
        case "inventory":
          insertInventory({
            id: `inv_${household.id}_${String(basePosition.inventory).padStart(4, "0")}`,
            name: `${household.name} asset ${basePosition.inventory + 1}`,
            purchase_date: Date.UTC(2022, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            warranty_expiry: Date.UTC(2026, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            reminder: rand() < 0.25 ? Date.UTC(2025, 0, 1) + randomInt(rand, 1, 90) * DAY_MS : null,
            position: basePosition.inventory++,
            household_id: household.id,
            created_at: createdAt,
            updated_at: Math.max(updatedAt, createdAt),
            deleted_at: deletedAt,
            root_key: rootKey,
            relative_path: relativePath,
          });
          break;
        case "vehicle": {
          const vehicleId = randomChoice(rand, supporting.vehicles.filter((v) => v.startsWith(`veh_${household.id}`)));
          insertVehicleMaint({
            id: `vehmaint_${household.id}_${String(basePosition.vehicle).padStart(4, "0")}`,
            vehicle_id: vehicleId,
            type: randomChoice(rand, ["Inspection", "Repair", "Tyre change", "Insurance"]),
            date: Date.UTC(2024, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            cost: randomInt(rand, 150, 2_500),
            household_id: household.id,
            created_at: createdAt,
            updated_at: Math.max(updatedAt, createdAt),
            deleted_at: deletedAt,
            root_key: rootKey,
            relative_path: relativePath,
          });
          basePosition.vehicle++;
          break;
        }
        case "pet": {
          const petId = randomChoice(rand, supporting.pets.filter((p) => p.startsWith(`pet_${household.id}`)));
          insertPetMedical({
            id: `petmed_${household.id}_${String(basePosition.pet).padStart(4, "0")}`,
            pet_id: petId,
            date: Date.UTC(2024, randomInt(rand, 0, 11), randomInt(rand, 1, 28)),
            description: `${household.name} pet check ${basePosition.pet + 1}`,
            reminder: rand() < 0.2 ? Date.UTC(2024, 0, 1) + randomInt(rand, 1, 30) * DAY_MS : null,
            household_id: household.id,
            created_at: createdAt,
            updated_at: Math.max(updatedAt, createdAt),
            deleted_at: deletedAt,
            root_key: rootKey,
            relative_path: relativePath,
          });
          basePosition.pet++;
          break;
        }
      }

        generated++;
      }
    }
  });

  run();

  stats.reusedLogicalFiles = Array.from(sourceUsage.values()).filter((count) => count > 1).length;

  return stats;
}

function main() {
  const opts = parseArgs();
  resetTargets(opts);
  ensureDirectories(opts);

  const db = new Database(opts.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  applyMigrations(db);

  const rand = mulberry32(opts.seed);

  const previousForeignKeys = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");

  try {
    const households = generateHouseholds(db, rand, opts.households);
    const categoryIndex = generateCategories(db, households);
    const eventStats = generateEvents(db, households, rand, opts.events);
    const noteStats = generateNotes(db, households, rand, opts.notes, categoryIndex);
    const sources = loadAttachmentCorpus();
    const supporting = generateSupportingRecords(db, households, rand);
    const attachmentStats = generateAttachments(db, households, rand, opts, opts.attachments, sources, supporting);

    const summary: GenerationSummary = {
      database: opts.dbPath,
      households: households.length,
      seed: opts.seed,
      events: eventStats,
      notes: noteStats,
      attachments: attachmentStats,
    };

    validateSummary(summary, opts);

    if (opts.summaryPath) {
      fs.mkdirSync(path.dirname(opts.summaryPath), { recursive: true });
      fs.writeFileSync(opts.summaryPath, JSON.stringify(summary, null, 2) + "\n");
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? "ON" : "OFF"}`);
  }
}

main();
