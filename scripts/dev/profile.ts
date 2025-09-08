import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { performance } from "node:perf_hooks";

const DAY = 86_400_000;

function defaultDbPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "com.paula.arklowdun-dev", "arklowdun.sqlite3");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appdata, "com.paula.arklowdun-dev", "arklowdun.sqlite3");
  }
  return path.join(home, ".local", "share", "com.paula.arklowdun-dev", "arklowdun.sqlite3");
}

function isDevSafe(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.includes("arklowdun-dev") || lower.endsWith("dev.sqlite3");
}

interface Options { dbPath: string; }

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = { dbPath: defaultDbPath() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--db":
        opts.dbPath = args[++i];
        break;
      case "--help":
        console.log("Usage: profile.ts [--db path]");
        process.exit(0);
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(1);
    }
  }
  return opts;
}

export function runProfile(dbPath: string) {
  if (!path.isAbsolute(dbPath)) throw new Error("db path must be absolute");
  if (!isDevSafe(dbPath)) throw new Error(`Refusing to touch non-dev path: ${dbPath}`);
  if (process.env.VITE_ENV !== "development") throw new Error("VITE_ENV must be 'development'");

  const db = new Database(dbPath);

  const hh = db.prepare("SELECT id FROM household LIMIT 1").get();
  if (!hh) {
    console.error("No households found");
    return;
  }
  const hhId = hh.id as string;

  const today = Date.now();
  const start = today - 90 * DAY;
  const end = today + 90 * DAY;

  const queries = [
    {
      sql: "SELECT COUNT(*) FROM events WHERE household_id=? AND start_at BETWEEN ? AND ?",
      params: [hhId, start, end],
    },
    {
      sql: "SELECT * FROM bills WHERE household_id=? AND due_date BETWEEN ? AND ? ORDER BY due_date LIMIT 50",
      params: [hhId, start, end],
    },
    {
      sql: "SELECT SUM(amount) FROM expenses WHERE household_id=? AND date BETWEEN ? AND ? GROUP BY category_id",
      params: [hhId, start, end],
    },
  ];

  for (const q of queries) {
    console.log("QUERY:", q.sql);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params);
    for (const row of plan) console.log("  ", row.detail);
    const stmt = db.prepare(q.sql);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      stmt.all(...q.params);
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`  avg ${avg.toFixed(2)} ms, median ${median.toFixed(2)} ms`);
  }

  db.close();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const opts = parseArgs();
  runProfile(opts.dbPath);
}

