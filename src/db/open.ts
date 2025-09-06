import Database from "@tauri-apps/plugin-sql";

// Open once (singleton)
let dbPromise: Promise<Database> | null = null;

export function openDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // This path is relative to the app’s data dir, e.g.
      // ~/Library/Application Support/com.paula.arklowdun/arklowdun.sqlite3
      const db = await Database.load("sqlite:arklowdun.sqlite3");

      // Apply durability-focused PRAGMAs on this connection as well
      await db.execute("PRAGMA journal_mode=WAL;");
      await db.execute("PRAGMA synchronous=FULL;");
      await db.execute("PRAGMA foreign_keys=ON;");
      await db.execute("PRAGMA busy_timeout = 5000;");
      await db.execute("PRAGMA wal_autocheckpoint = 1000;");

      return db;
    })();
  }
  return dbPromise;
}
