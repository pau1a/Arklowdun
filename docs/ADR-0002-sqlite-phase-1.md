# ADR-0002 — SQLite integration: phase 1 (DB open + pragmas)

Status: Accepted
Date: 2025-09-01

Context
We’re moving storage from JSON files to SQLite in a Tauri v2 app. This first slice wires the SQL plugin, creates the DB file at startup, and applies safe pragmas. The UI still reads/writes JSON for now, so behavior is unchanged by design.

Decision
Open a single SQLite database at app scope using @tauri-apps/plugin-sql:

    // src/db/open.ts
    import Database from "@tauri-apps/plugin-sql";
    export async function openDb() {
      const db = await Database.load("sqlite:app.sqlite");
      await db.execute("PRAGMA journal_mode=WAL;");
      await db.execute("PRAGMA synchronous=NORMAL;");
      await db.execute("PRAGMA foreign_keys=ON;");
      return db;
    }

Notes
The sqlite:app.sqlite path resolves under the app’s data dir, e.g.:
~/Library/Application Support/com.paula.arklowdun/app.sqlite (macOS).
