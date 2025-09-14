/*
Integration test to ensure a migration that crashes before commit
is fully rolled back on next startup. A child process opens a temp
SQLite database, begins a transaction, creates a table and inserts a row,
then aborts without committing. The parent process then reopens the same
database and verifies the table does not exist and the database passes
integrity checks.
*/

use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};
use sqlx::{ConnectOptions, Connection};
use std::env;
use std::path::PathBuf;
use std::process::Command;
use tempfile::tempdir;

#[cfg(unix)]
use libc;

#[tokio::test]
async fn crash_mid_migration() -> Result<()> {
    if env::var("CRASH_CHILD").as_deref() == Ok("1") {
        child().await?;
        unreachable!();
    }

    parent().await
}

async fn child() -> Result<()> {
    let db_path = PathBuf::from(env::var("CRASH_DB")?);

    let mut conn = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .disable_statement_logging()
        .connect()
        .await?;

    let mut tx = conn.begin().await?;
    sqlx::query("CREATE TABLE crashy (id INTEGER PRIMARY KEY, name TEXT);")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO crashy (name) VALUES ('boom');")
        .execute(&mut *tx)
        .await?;

    #[cfg(unix)]
    unsafe {
        libc::abort();
    }
    #[cfg(not(unix))]
    std::process::abort();
}

async fn parent() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("crash_test.sqlite3");

    let mut child = Command::new(env::current_exe()?)
        .env("CRASH_CHILD", "1")
        .env("CRASH_DB", &db_path)
        .arg("--exact")
        .arg("crash_mid_migration")
        .arg("--test-threads=1")
        .spawn()?;
    // Child aborts so exit status is non-zero; just wait for it.
    let _ = child.wait();

    // Allow OS to release file handles (especially on Windows).
    std::thread::sleep(std::time::Duration::from_millis(50));

    let mut conn = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .disable_statement_logging()
        .connect()
        .await?;

    let exists: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='crashy';",
    )
    .fetch_optional(&mut conn)
    .await?;
    assert!(exists.is_none(), "table `crashy` should not exist");

    let ok: String = sqlx::query_scalar("PRAGMA integrity_check;")
        .fetch_one(&mut conn)
        .await?;
    assert_eq!(ok, "ok", "integrity_check must be ok");

    let quick: String = sqlx::query_scalar("PRAGMA quick_check;")
        .fetch_one(&mut conn)
        .await?;
    assert!(quick == "ok" || quick == "0", "quick_check expected ok/0 got {quick}");

    Ok(())
}

