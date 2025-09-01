use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Executor, Row, SqlitePool,
};
use std::{collections::HashSet, fs};
use tauri::{AppHandle, Manager};

use crate::time::now_ms;

static MIGRATIONS: &[(&str, &str)] = &[
    (
        "202509012006_household.sql",
        include_str!("../../migrations/202509012006_household.sql"),
    ),
    (
        "202509012007_domain_tables.sql",
        include_str!("../../migrations/202509012007_domain_tables.sql"),
    ),
];

pub async fn init_db(app: &AppHandle) -> anyhow::Result<SqlitePool> {
    // Use the same base directory as tauri-plugin-sql (frontend) for a single shared DB.
    let dir = app.path().app_data_dir().expect("data dir");
    fs::create_dir_all(&dir)?;
    let db_path = dir.join("app.sqlite");

    // Build options from a filesystem path to avoid URL encoding issues.
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new().connect_with(opts).await?;

    // Reassert pragmas in case the options are ignored.
    pool.execute("PRAGMA journal_mode=WAL").await?;
    pool.execute("PRAGMA foreign_keys=ON").await?;
    pool
        .execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
        )
        .await?;

    let rows = sqlx::query("SELECT version FROM schema_migrations")
        .fetch_all(&pool)
        .await?;
    let applied: HashSet<String> = rows
        .into_iter()
        .filter_map(|r| r.try_get::<String, _>("version").ok())
        .collect();

    for (filename, sql) in MIGRATIONS {
        if applied.contains(*filename) {
            continue;
        }
        for stmt in sql.split(';') {
            let s = stmt.trim();
            if s.is_empty() {
                continue;
            }
            pool.execute(s).await?;
        }
        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
            .bind(*filename)
            .bind(now_ms())
            .execute(&pool)
            .await?;
    }

    Ok(pool)
}
