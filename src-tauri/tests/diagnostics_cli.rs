use std::path::Path;

use anyhow::Result;
use arklowdun_lib::diagnostics::HouseholdStatsEntry;
use arklowdun_lib::ipc::guard::{DB_UNHEALTHY_CLI_HINT, DB_UNHEALTHY_EXIT_CODE};
use arklowdun_lib::migrate;
use assert_cmd::Command;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{ConnectOptions, Connection};
use tempfile::tempdir;

async fn migrate_database(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    migrate::apply_migrations(&pool).await?;
    pool.close().await;
    Ok(())
}

async fn seed_fk_violation(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut conn = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .connect()
        .await?;

    sqlx::query("PRAGMA foreign_keys = OFF;")
        .execute(&mut conn)
        .await?;
    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)\n         VALUES ('broken-note', 'missing', NULL, 0, 0, 0, 0, 'Dangling note', '#FFFFFF', 0, 0)",
    )
    .execute(&mut conn)
    .await?;
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&mut conn)
        .await?;
    conn.close().await?;
    Ok(())
}

#[tokio::test]
async fn household_stats_cli_outputs_json() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");

    migrate_database(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["diagnostics", "household-stats", "--json"])
        .output()?;

    assert!(
        output.status.success(),
        "command failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let rows: Vec<HouseholdStatsEntry> = serde_json::from_slice(&output.stdout)?;
    assert!(!rows.is_empty(), "expected at least one household entry");

    Ok(())
}

#[tokio::test]
async fn household_stats_cli_blocks_when_unhealthy() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");

    migrate_database(&db_path).await?;
    seed_fk_violation(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["diagnostics", "household-stats", "--json"])
        .output()?;

    assert!(
        !output.status.success(),
        "expected non-zero exit, stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.status.code(), Some(DB_UNHEALTHY_EXIT_CODE));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("DB_UNHEALTHY_WRITE_BLOCKED"),
        "expected DB_UNHEALTHY_WRITE_BLOCKED in stderr, got {stderr}"
    );
    assert!(
        stderr.contains(DB_UNHEALTHY_CLI_HINT),
        "expected {DB_UNHEALTHY_CLI_HINT} hint in stderr, got {stderr}"
    );

    Ok(())
}
