use std::path::Path;

use anyhow::Result;
use arklowdun_lib::db::health::{DbHealthReport, DbHealthStatus};
use assert_cmd::Command;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::Connection;
use tempfile::tempdir;

async fn prepare_fk_violation(db_path: &Path) -> Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut conn = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .connect()
        .await?;

    sqlx::query("PRAGMA foreign_keys = OFF;")
        .execute(&mut conn)
        .await?;
    sqlx::query("CREATE TABLE parent(id INTEGER PRIMARY KEY);")
        .execute(&mut conn)
        .await?;
    sqlx::query(
        "CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));",
    )
    .execute(&mut conn)
    .await?;
    sqlx::query("INSERT INTO child(id, parent_id) VALUES (1, 999);")
        .execute(&mut conn)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&mut conn)
        .await?;

    conn.close().await?;
    Ok(())
}

async fn ensure_database(db_path: &Path) -> Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    pool.close().await;
    Ok(())
}

#[tokio::test]
async fn db_status_cli_reports_ok() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");

    let db_path = appdata.join("arklowdun.sqlite3");
    ensure_database(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "status"])
        .output()?;
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Status       : ok"));
    assert!(stdout.contains("Checks:"));
    assert!(stdout.contains("Offenders"));

    let json_output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "status", "--json"])
        .output()?;
    assert!(json_output.status.success());
    let report: DbHealthReport = serde_json::from_slice(&json_output.stdout)?;
    assert_eq!(report.status, DbHealthStatus::Ok);

    Ok(())
}

#[tokio::test]
async fn db_status_cli_reports_error_and_nonzero_exit() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");

    prepare_fk_violation(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "status"])
        .output()?;
    assert!(
        !output.status.success(),
        "expected non-zero exit, stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Status       : error"));
    assert!(stdout.contains("foreign_key_check"));
    assert!(stdout.contains("Offenders"));

    let json_output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "status", "--json"])
        .output()?;
    assert!(!json_output.status.success());
    let report: DbHealthReport = serde_json::from_slice(&json_output.stdout)?;
    assert_eq!(report.status, DbHealthStatus::Error);

    Ok(())
}
