import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_ROWS = 10_000;
const DEFAULT_SEED = 104729; // prime seed for deterministic spread
const DEFAULT_HOUSEHOLD_ID = "bench_hh";
const DEFAULT_HOUSEHOLD_TZ = "America/New_York";

interface Options {
  rows: number;
  output: string;
  seed: number;
  household: string;
  tz: string;
}

interface GenerationStats {
  timedSingles: number;
  allDaySingles: number;
  dailySeries: number;
  weeklySeries: number;
  seriesWithExdates: number;
  exdateCount: number;
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
      case "--rows": {
        opts.rows = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(opts.rows) || opts.rows <= 0) {
          throw new Error("--rows must be a positive integer");
        }
        break;
      }
      case "--output": {
        opts.output = args[++i] ?? "";
        break;
      }
      case "--seed": {
        opts.seed = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(opts.seed)) {
          throw new Error("--seed must be an integer");
        }
        break;
      }
      case "--household": {
        opts.household = args[++i] ?? DEFAULT_HOUSEHOLD_ID;
        break;
      }
      case "--tz": {
        opts.tz = args[++i] ?? DEFAULT_HOUSEHOLD_TZ;
        break;
      }
      case "--help":
      case "-h": {
        console.log(
          "Usage: generate_query_fixture.ts [options]\n" +
            "  --rows N         Number of events to generate (default 10000)\n" +
            "  --output PATH    Destination sqlite file (default fixtures/time/query/query-<rows>.sqlite3)\n" +
            "  --seed N         PRNG seed (default 104729)\n" +
            "  --household ID   Household id to seed (default bench_hh)\n" +
            "  --tz NAME        Household fallback timezone (default America/New_York)\n"
        );
        process.exit(0);
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.output) {
    const suffix = opts.rows >= 1000 && opts.rows % 1000 === 0 ? `${opts.rows / 1000}k` : `${opts.rows}`;
    opts.output = path.join("fixtures", "time", "query", `query-${suffix}.sqlite3`);
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

function randomChoice<T>(rand: () => number, values: T[]): T {
  return values[Math.floor(rand() * values.length)];
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
      reminder INTEGER,
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
    name: "Query Benchmark Household",
    tz: householdTz,
    created_at: now - DAY_MS,
    updated_at: now - DAY_MS / 2,
  });
}

function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

function pickByDay(rand: () => number): string {
  const bydayOptions = [
    ["MO"],
    ["TU"],
    ["WE"],
    ["TH"],
    ["FR"],
    ["SA"],
    ["SU"],
    ["MO", "WE"],
    ["TU", "TH"],
    ["MO", "WE", "FR"],
    ["TU", "TH", "SU"],
    ["SA", "SU"],
  ];
  return randomChoice(rand, bydayOptions).join(",");
}

function generateEvents(db: Database.Database, opts: Options): GenerationStats {
  const rand = mulberry32(opts.seed);
  const base = Date.UTC(2024, 2, 1); // 2024-03-01 UTC baseline
  const tzPool: (string | null)[] = [
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "America/Los_Angeles",
    "America/New_York",
    "Asia/Tokyo",
    null,
  ];
  const recurrenceTzPool: string[] = [
    "UTC",
    "Europe/London",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Tokyo",
  ];

  const insert = db.prepare(
    `INSERT INTO events (
      id, title, start_at, end_at, tz, household_id,
      created_at, updated_at, deleted_at, start_at_utc, end_at_utc, reminder, rrule, exdates
    ) VALUES (
      @id, @title, @start_at, @end_at, @tz, @household_id,
      @created_at, @updated_at, NULL, NULL, NULL, @reminder, @rrule, @exdates
    )`
  );

  const stats: GenerationStats = {
    timedSingles: 0,
    allDaySingles: 0,
    dailySeries: 0,
    weeklySeries: 0,
    seriesWithExdates: 0,
    exdateCount: 0,
  };

  const txn = db.transaction((count: number) => {
    for (let i = 0; i < count; i++) {
      const ticket = rand();
      const id = `evt_${(i + 1).toString().padStart(7, "0")}`;

      if (ticket < 0.55) {
        // Timed single event
        const tz = randomChoice(rand, tzPool);
        const daySpread = randomInt(rand, -40, 120);
        const minuteOffset = randomInt(rand, 6 * 60, 20 * 60);
        const startAt = base + daySpread * DAY_MS + minuteOffset * 60_000;
        const durationMinutes = randomInt(rand, 45, 210);
        const endAt = rand() < 0.15 ? null : startAt + durationMinutes * 60_000;
        insert.run({
          id,
          title: `Session ${(i % 12) + 1}`,
          start_at: Math.trunc(startAt),
          end_at: endAt === null ? null : Math.trunc(endAt),
          tz,
          household_id: opts.household,
          created_at: startAt - HOUR_MS,
          updated_at: startAt - HOUR_MS / 2,
          reminder: null,
          rrule: null,
          exdates: null,
        });
        stats.timedSingles += 1;
        continue;
      }

      if (ticket < 0.7) {
        // All-day single block
        const daySpread = randomInt(rand, -30, 90);
        const startAt = alignToMidnight(base + daySpread * DAY_MS);
        const span = randomInt(rand, 1, 3);
        const endAt = startAt + span * DAY_MS;
        insert.run({
          id,
          title: `All-day ${(i % 8) + 1}`,
          start_at: Math.trunc(startAt),
          end_at: Math.trunc(endAt),
          tz: null,
          household_id: opts.household,
          created_at: startAt - DAY_MS,
          updated_at: startAt - DAY_MS / 2,
          reminder: null,
          rrule: null,
          exdates: null,
        });
        stats.allDaySingles += 1;
        continue;
      }

      if (ticket < 0.88) {
        // Daily recurrence, occasionally with EXDATEs (UTC series)
        const tz = rand() < 0.35 ? "UTC" : randomChoice(rand, recurrenceTzPool);
        const daySpread = randomInt(rand, -20, 80);
        const minuteOffset = randomInt(rand, 7 * 60, 19 * 60);
        const startAt = base + daySpread * DAY_MS + minuteOffset * 60_000;
        const durationMinutes = randomInt(rand, 30, 120);
        const endAt = startAt + durationMinutes * 60_000;
        const interval = randomInt(rand, 1, 3);
        const count = randomInt(rand, 10, 24);
        const rrule = `FREQ=DAILY;INTERVAL=${interval};COUNT=${count}`;

        let exdates: string | null = null;
        if (tz === "UTC" && rand() < 0.6) {
          const skipOccurrences = randomInt(rand, 1, Math.min(3, count - 1));
          const skips = new Set<number>();
          while (skips.size < skipOccurrences) {
            skips.add(randomInt(rand, 0, count - 1));
          }
          const exclusions: string[] = [];
          for (const occIndex of skips) {
            const occStart = startAt + occIndex * interval * DAY_MS;
            exclusions.push(formatIso(occStart));
          }
          exdates = exclusions.join(",");
          stats.seriesWithExdates += 1;
          stats.exdateCount += exclusions.length;
        }

        insert.run({
          id,
          title: `Daily series ${(i % 9) + 1}`,
          start_at: Math.trunc(startAt),
          end_at: Math.trunc(endAt),
          tz,
          household_id: opts.household,
          created_at: startAt - HOUR_MS,
          updated_at: startAt - HOUR_MS / 3,
          reminder: null,
          rrule,
          exdates,
        });
        stats.dailySeries += 1;
        continue;
      }

      // Weekly recurrence without EXDATEs
      const tz = randomChoice(rand, recurrenceTzPool);
      const daySpread = randomInt(rand, -15, 70);
      const minuteOffset = randomInt(rand, 8 * 60, 18 * 60);
      const startAt = base + daySpread * DAY_MS + minuteOffset * 60_000;
      const durationMinutes = randomInt(rand, 45, 160);
      const endAt = startAt + durationMinutes * 60_000;
      const interval = randomInt(rand, 1, 2);
      const count = randomInt(rand, 8, 18);
      const byDay = pickByDay(rand);
      const rrule = `FREQ=WEEKLY;INTERVAL=${interval};COUNT=${count};BYDAY=${byDay}`;

      insert.run({
        id,
        title: `Weekly series ${(i % 7) + 1}`,
        start_at: Math.trunc(startAt),
        end_at: Math.trunc(endAt),
        tz,
        household_id: opts.household,
        created_at: startAt - HOUR_MS,
        updated_at: startAt - HOUR_MS / 3,
        reminder: null,
        rrule,
        exdates: null,
      });
      stats.weeklySeries += 1;
    }
  });

  txn(opts.rows);
  return stats;
}

function main() {
  const opts = parseArgs();
  const db = prepareDatabase(opts.output);
  let stats: GenerationStats | undefined;
  try {
    createSchema(db, opts.household, opts.tz);
    stats = generateEvents(db, opts);
  } finally {
    db.close();
  }

  if (!stats) {
    throw new Error("Fixture generation failed");
  }

  console.log(
    `Generated ${opts.rows.toLocaleString()} events at ${opts.output} (seed=${opts.seed}, household=${opts.household})`
  );
  console.log(
    `Breakdown: timed=${stats.timedSingles}, all-day=${stats.allDaySingles}, daily-series=${stats.dailySeries}, weekly-series=${stats.weeklySeries}`
  );
  console.log(
    `Series with EXDATEs: ${stats.seriesWithExdates} (total exclusions=${stats.exdateCount})`
  );
}

main();
