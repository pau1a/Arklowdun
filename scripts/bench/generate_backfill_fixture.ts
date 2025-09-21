import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_SEED = 42;
const DEFAULT_ROWS = 10_000;
const DEFAULT_HOUSEHOLD_ID = "bench_hh";
const DEFAULT_HOUSEHOLD_TZ = "America/New_York";

interface Options {
  rows: number;
  output: string;
  seed: number;
  household: string;
  tz: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = {
    rows: DEFAULT_ROWS,
    output: "",
    seed: DEFAULT_SEED,
    household: DEFAULT_HOUSEHOLD_ID,
    tz: DEFAULT_HOUSEHOLD_TZ,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--rows":
        opts.rows = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(opts.rows) || opts.rows <= 0) {
          throw new Error("--rows must be a positive integer");
        }
        break;
      case "--output":
        opts.output = args[++i] ?? "";
        break;
      case "--seed":
        opts.seed = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(opts.seed)) {
          throw new Error("--seed must be an integer");
        }
        break;
      case "--household":
        opts.household = args[++i] ?? DEFAULT_HOUSEHOLD_ID;
        break;
      case "--tz":
        opts.tz = args[++i] ?? DEFAULT_HOUSEHOLD_TZ;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: generate_backfill_fixture.ts [options]\n" +
            "  --rows N         Number of events to generate (default 10000)\n" +
            "  --output PATH    Destination sqlite file (default fixtures/time/backfill/backfill-<rows>.sqlite3)\n" +
            "  --seed N         PRNG seed (default 42)\n" +
            "  --household ID   Household id to seed (default bench_hh)\n" +
            "  --tz NAME        Household fallback timezone (default America/New_York)\n"
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.output) {
    const suffix = opts.rows >= 1000 && opts.rows % 1000 === 0 ? `${opts.rows / 1000}k` : `${opts.rows}`;
    opts.output = path.join("fixtures", "time", "backfill", `backfill-${suffix}.sqlite3`);
  }

  opts.output = path.resolve(opts.output);
  return opts;
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

function alignToMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function prepareDatabase(dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest);
  }

  const db = new Database(dest);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function createSchema(db: Database.Database, householdId: string, householdTz: string) {
  db.exec(`
    BEGIN;
    DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS household;
    CREATE TABLE household (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tz TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER,
      tz TEXT,
      household_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      start_at_utc INTEGER,
      end_at_utc INTEGER,
      rrule TEXT,
      exdates TEXT,
      FOREIGN KEY(household_id) REFERENCES household(id)
    );
    CREATE INDEX IF NOT EXISTS events_household_start_idx ON events(household_id, start_at);
    COMMIT;
  `);

  const now = Date.UTC(2024, 0, 1);
  const insertHousehold = db.prepare(
    `INSERT INTO household (id, name, tz, created_at, updated_at, deleted_at)
     VALUES (@id, @name, @tz, @created_at, @updated_at, NULL)`
  );
  insertHousehold.run({
    id: householdId,
    name: "Benchmark Household",
    tz: householdTz,
    created_at: now - DAY_MS,
    updated_at: now - DAY_MS / 2,
  });
}

function generateEvents(db: Database.Database, opts: Options) {
  const rand = mulberry32(opts.seed);
  const base = Date.UTC(2024, 0, 15);
  const tzPool: (string | null)[] = [
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "America/Los_Angeles",
    "America/New_York",
    "Asia/Tokyo",
    null,
  ];

  const insert = db.prepare(
    `INSERT INTO events (
      id, title, start_at, end_at, tz, household_id,
      created_at, updated_at, deleted_at, start_at_utc, end_at_utc, rrule, exdates
    ) VALUES (
      @id, @title, @start_at, @end_at, @tz, @household_id,
      @created_at, @updated_at, NULL, NULL, NULL, NULL, NULL
    )`
  );

  const txn = db.transaction((count: number) => {
    for (let i = 0; i < count; i++) {
      const ticket = rand();
      const id = `evt_${(i + 1).toString().padStart(7, "0")}`;
      const tz = tzPool[Math.floor(rand() * tzPool.length)] ?? null;
      const daySpread = randomInt(rand, -180, 180);
      const startBase = base + daySpread * DAY_MS;

      let startAt: number;
      let endAt: number | null;
      let title: string;

      if (ticket < 0.3) {
        // All-day event anchored to midnight
        startAt = alignToMidnight(startBase);
        const daySpan = randomInt(rand, 1, 3);
        endAt = startAt + daySpan * DAY_MS;
        title = `All-day block ${(i % 8) + 1}`;
      } else {
        // Timed event with 45-180 minute duration, occasionally open-ended
        const minuteOffset = randomInt(rand, 0, DAY_MS - HOUR_MS);
        startAt = startBase + minuteOffset;
        const durationMinutes = randomInt(rand, 45, 180);
        endAt = rand() < 0.12 ? null : startAt + durationMinutes * 60_000;
        title = `Timed session ${(i % 10) + 1}`;
      }

      insert.run({
        id,
        title,
        start_at: Math.trunc(startAt),
        end_at: endAt === null ? null : Math.trunc(endAt),
        tz,
        household_id: opts.household,
        created_at: startAt - HOUR_MS,
        updated_at: startAt - HOUR_MS / 2,
      });
    }
  });

  txn(opts.rows);
}

function main() {
  const opts = parseArgs();
  const db = prepareDatabase(opts.output);
  try {
    createSchema(db, opts.household, opts.tz);
    generateEvents(db, opts);
  } finally {
    db.close();
  }

  console.log(
    `Generated ${opts.rows.toLocaleString()} events at ${opts.output} (seed=${opts.seed}, household=${opts.household})`
  );
}

main();
