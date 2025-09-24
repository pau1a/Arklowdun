use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{Context, Result};
use arklowdun_lib::db::health::DbHealthStatus;
use arklowdun_lib::db::repair::{self, DbRepairOptions};
use arklowdun_lib::AppError;
use assert_cmd::Command;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{ConnectOptions, Connection, Row};
use tempfile::tempdir;

fn wal_path(db_path: &Path) -> PathBuf {
    let mut os = OsString::from(db_path.as_os_str());
    os.push("-wal");
    PathBuf::from(os)
}

async fn open_pool(db_path: &Path) -> Result<sqlx::SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true);

    Ok(SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .context("open sqlite pool")?)
}

fn repair_options(pool: &sqlx::SqlitePool, db_path: &Path) -> DbRepairOptions {
    let pool_clone = pool.clone();
    let db_path = db_path.to_path_buf();
    DbRepairOptions {
        before_swap: Some(Arc::new(move || {
            let pool = pool_clone.clone();
            Box::pin(async move {
                pool.close().await;
                Ok(())
            })
        })),
        after_swap: Some(Arc::new(move || {
            let db_path = db_path.clone();
            Box::pin(async move {
                let pool = open_pool(&db_path).await.map_err(|err| {
                    AppError::from(err).with_context("operation", "reopen_pool_for_tests")
                })?;
                let report = arklowdun_lib::db::health::run_health_checks(&pool, &db_path)
                    .await
                    .map_err(|err| err.with_context("operation", "repair_post_swap_health"))?;
                pool.close().await;
                Ok(Some(report))
            })
        })),
    }
}

#[tokio::test]
async fn repair_recovers_from_wal_bloat() -> Result<()> {
    let tmp = tempdir()?;
    let db_path = tmp.path().join("arklowdun.sqlite3");

    let mut conn = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .connect()
        .await?;

    sqlx::query("PRAGMA wal_autocheckpoint = 0;")
        .execute(&mut conn)
        .await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, value TEXT);")
        .execute(&mut conn)
        .await?;

    for idx in 0..128 {
        sqlx::query("INSERT INTO items(value) VALUES (?);")
            .bind(format!("value-{idx}"))
            .execute(&mut conn)
            .await?;
    }

    conn.close().await?;

    let wal_file = wal_path(&db_path);
    assert!(
        wal_file.exists(),
        "expected WAL file to exist before repair"
    );

    let pool = open_pool(&db_path).await?;
    let options = repair_options(&pool, &db_path);
    let summary = repair::run_guided_repair(&pool, &db_path, None, options)
        .await
        .map_err(anyhow::Error::new)?;

    pool.close().await;

    assert!(summary.success, "repair should succeed");
    assert!(summary.error.is_none(), "no error expected on success");
    assert!(
        summary.backup_directory.is_some(),
        "pre-repair backup directory recorded"
    );
    assert!(
        summary.backup_sqlite_path.is_some(),
        "pre-repair sqlite snapshot recorded"
    );
    assert!(summary.archived_db_path.is_some(), "archived db recorded");
    let health = summary.health_report.expect("health report present");
    assert_eq!(health.status, DbHealthStatus::Ok);

    let archived_path = summary
        .archived_db_path
        .as_ref()
        .map(PathBuf::from)
        .expect("archived path");
    assert!(archived_path.exists(), "archived db should exist");
    assert!(
        !wal_file.exists(),
        "wal file should be removed after repair"
    );

    Ok(())
}

#[tokio::test]
async fn repair_fails_validation_and_restores_original() -> Result<()> {
    let tmp = tempdir()?;
    let db_path = tmp.path().join("arklowdun.sqlite3");

    let mut conn = SqliteConnectOptions::new()
        .filename(&db_path)
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

    let pool = open_pool(&db_path).await?;
    let options = repair_options(&pool, &db_path);
    let summary = repair::run_guided_repair(&pool, &db_path, None, options)
        .await
        .map_err(anyhow::Error::new)?;
    pool.close().await;

    assert!(!summary.success, "repair should fail validation");
    let error = summary.error.expect("expected error summary");
    assert_eq!(error.code(), "DB_REPAIR/FOREIGN_KEY_FAILED");
    assert!(summary.archived_db_path.is_none(), "no archive on failure");
    assert!(
        summary.backup_directory.is_some(),
        "pre-repair backup still recorded"
    );

    // Original database should remain unchanged with violating row.
    let mut conn = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(false)
        .connect()
        .await?;
    let count: i64 = sqlx::query("SELECT COUNT(*) FROM child WHERE parent_id = 999;")
        .fetch_one(&mut conn)
        .await?
        .get(0);
    assert_eq!(count, 1, "violating row should remain in original db");
    conn.close().await?;

    // Temporary repair files should have been cleaned up.
    let parent = db_path.parent().expect("db path has parent");
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        assert!(
            !name.starts_with("repair-new-"),
            "temporary repair db should be removed"
        );
    }

    Ok(())
}

#[test]
fn repair_interrupted_during_rebuild_preserves_original() -> Result<()> {
    let tmp = tempdir()?;
    let db_root = tmp.path();
    let db_path = db_root.join("arklowdun.sqlite3");

    tauri::async_runtime::block_on(async {
        let mut conn = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .foreign_keys(true)
            .connect()
            .await?;

        sqlx::query("CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, value TEXT);")
            .execute(&mut conn)
            .await?;
        sqlx::query("INSERT INTO items(value) VALUES ('original');")
            .execute(&mut conn)
            .await?;
        conn.close().await?;
        Result::<()>::Ok(())
    })?;

    let mut cmd = Command::cargo_bin("arklowdun")?;
    cmd.env("ARK_FAKE_APPDATA", db_root)
        .arg("db")
        .arg("repair")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().context("spawn repair process")?;
    let stdout = child.stdout.take().context("child stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    while reader.read_line(&mut line)? != 0 {
        if line.contains("Rebuild") && line.contains("running") {
            let _ = child.kill();
            break;
        }
        line.clear();
    }
    let _ = child.kill();
    let _ = child.wait();

    let count = tauri::async_runtime::block_on(async {
        let mut conn = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .foreign_keys(true)
            .connect()
            .await?;
        let count: i64 = sqlx::query("SELECT COUNT(*) FROM items;")
            .fetch_one(&mut conn)
            .await?
            .get(0);
        conn.close().await?;
        Result::<i64>::Ok(count)
    })?;
    assert_eq!(count, 1, "original database rows should remain");

    let backup_root = db_root.join("backups");
    assert!(
        backup_root.exists(),
        "pre-repair backup directory should exist"
    );
    let mut entries = fs::read_dir(&backup_root)?;
    assert!(
        entries.next().is_some(),
        "backup directory should contain snapshot"
    );

    let archive = db_root.join("pre-repair.sqlite3");
    assert!(
        !archive.exists(),
        "archive should not exist when swap never executed"
    );

    Ok(())
}
