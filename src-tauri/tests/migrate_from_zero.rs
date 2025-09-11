use anyhow::{Context, Result};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::{fs, path::PathBuf};
use tempfile::tempdir;

fn crate_dir() -> PathBuf {
    // src-tauri crate directory
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn migrations_dir() -> PathBuf {
    crate_dir().join("../migrations")
}

fn list_up_versions() -> Result<Vec<String>> {
    let dir = migrations_dir();
    let mut ups = fs::read_dir(&dir)
        .with_context(|| format!("read_dir({})", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "sql").unwrap_or(false))
        .filter(|p| p
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".up.sql") && !n.starts_with('_'))
            .unwrap_or(false))
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    ups.sort();
    Ok(ups)
}

async fn assert_table_exists(pool: &SqlitePool, name: &str) -> Result<()> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?;
    assert!(exists.is_some(), "expected table `{name}`");
    Ok(())
}

async fn assert_index_exists(pool: &SqlitePool, name: &str) -> Result<()> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?;",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?;
    assert!(exists.is_some(), "expected index `{name}`");
    Ok(())
}

async fn assert_fk_and_integrity_ok(pool: &SqlitePool) -> Result<()> {
    let fk_on: i64 = sqlx::query_scalar("PRAGMA foreign_keys;").fetch_one(pool).await?;
    assert_eq!(fk_on, 1, "PRAGMA foreign_keys must be ON");
    let fk_rows = sqlx::query("PRAGMA foreign_key_check;").fetch_all(pool).await?;
    assert!(fk_rows.is_empty(), "foreign_key_check reported violations");
    let ok: String = sqlx::query_scalar("PRAGMA integrity_check;").fetch_one(pool).await?;
    assert_eq!(ok, "ok", "integrity_check must be ok, got: {ok}");
    Ok(())
}

#[tokio::test]
async fn migrate_from_zero_is_correct_and_idempotent() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("from_zero.sqlite");
    let url = format!("sqlite://{}?mode=rwc", db_path.display());

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .context("connect sqlite")?;
    sqlx::query("PRAGMA journal_mode=WAL;").execute(&pool).await?;
    sqlx::query("PRAGMA synchronous=NORMAL;").execute(&pool).await?;
    sqlx::query("PRAGMA foreign_keys=ON;").execute(&pool).await?;

    arklowdun_lib::migrate::apply_migrations(&pool)
        .await
        .context("apply_migrations first run")?;

    for t in ["schema_migrations", "household", "events", "notes"] {
        assert_table_exists(&pool, t).await?;
    }

    assert_index_exists(&pool, "events_household_start_at_utc_idx").await?;

    assert_fk_and_integrity_ok(&pool).await?;

    let expected = list_up_versions()?;
    let applied: Vec<String> = sqlx::query("SELECT version FROM schema_migrations ORDER BY version;")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>("version"))
        .fetch_all(&pool)
        .await?;
    assert_eq!(applied.len(), expected.len(), "version count mismatch");
    assert_eq!(applied, expected, "schema_migrations must exactly match on-disk *.up.sql filenames");

    arklowdun_lib::migrate::apply_migrations(&pool)
        .await
        .context("apply_migrations second run")?;
    let applied2: Vec<String> = sqlx::query("SELECT version FROM schema_migrations ORDER BY version;")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>("version"))
        .fetch_all(&pool)
        .await?;
    assert_eq!(applied2, applied, "second run must not change schema_migrations");

    assert_fk_and_integrity_ok(&pool).await?;
    Ok(())
}

