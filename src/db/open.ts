import Database from "@tauri-apps/plugin-sql";

// Open once (singleton)
let dbPromise: Promise<Database> | null = null;

export function openDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // This path is relative to the app’s data dir, e.g.
      // ~/Library/Application Support/com.paula.arklowdun/app.sqlite
      const db = await Database.load("sqlite:app.sqlite");

      // Sensible defaults
      await db.execute("PRAGMA journal_mode=WAL;");
      await db.execute("PRAGMA synchronous=NORMAL;");
      await db.execute("PRAGMA foreign_keys=ON;");

      return db;
    })();
  }
  return dbPromise;
}
