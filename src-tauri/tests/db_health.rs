use std::path::Path;

use arklowdun_lib::db::health::{run_health_checks, DbHealthStatus};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tempfile::tempdir;

async fn open_pool(path: &Path) -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("create sqlite pool")
}

#[tokio::test]
async fn health_passes_on_clean_db() {
    let dir = tempdir().expect("temp dir");
    let db_path = dir.path().join("clean.sqlite3");
    let pool = open_pool(&db_path).await;

    let report = run_health_checks(&pool, &db_path)
        .await
        .expect("health check succeeds");
    assert_eq!(report.status, DbHealthStatus::Ok);
    assert!(report.checks.iter().all(|c| c.passed));
    assert!(report.offenders.is_empty());
}

#[tokio::test]
async fn foreign_key_violations_are_reported() {
    let dir = tempdir().expect("temp dir");
    let db_path = dir.path().join("fk.sqlite3");
    let pool = open_pool(&db_path).await;

    {
        let mut conn = pool.acquire().await.expect("acquire connection");
        sqlx::query("CREATE TABLE parent(id INTEGER PRIMARY KEY);")
            .execute(conn.as_mut())
            .await
            .expect("create parent");
        sqlx::query(
            "CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));",
        )
        .execute(conn.as_mut())
        .await
        .expect("create child");
        sqlx::query("INSERT INTO child(id, parent_id) VALUES (1, 999);")
            .execute(conn.as_mut())
            .await
            .expect("insert violating row");
    }

    let report = run_health_checks(&pool, &db_path)
        .await
        .expect("health check succeeds");
    assert_eq!(report.status, DbHealthStatus::Error);
    let fk_check = report
        .checks
        .iter()
        .find(|c| c.name == "foreign_key_check")
        .expect("fk check present");
    assert!(!fk_check.passed);
    assert!(!report.offenders.is_empty());
    assert_eq!(report.offenders[0].table, "child");
}

#[tokio::test]
async fn junk_wal_file_is_detected() {
    let dir = tempdir().expect("temp dir");
    let db_path = dir.path().join("wal.sqlite3");
    let pool = open_pool(&db_path).await;

    // Write garbage WAL file to trigger storage check failure.
    let wal_path = db_path.with_extension("sqlite3-wal");
    std::fs::write(&wal_path, b"not a wal").expect("write junk wal");

    let report = run_health_checks(&pool, &db_path)
        .await
        .expect("health check succeeds");
    assert_eq!(report.status, DbHealthStatus::Error);
    let storage = report
        .checks
        .iter()
        .find(|c| c.name == "storage_sanity")
        .expect("storage check present");
    assert!(!storage.passed);
}

#[tokio::test]
async fn page_size_mismatch_is_flagged() {
    let dir = tempdir().expect("temp dir");
    let db_path = dir.path().join("pagesize.sqlite3");

    // Initialize database with a non-standard page size.
    {
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete)
            .synchronous(SqliteSynchronous::Full)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("init pool");
        let mut conn = pool.acquire().await.expect("acquire connection");
        sqlx::query("PRAGMA page_size=2048;")
            .execute(conn.as_mut())
            .await
            .expect("set page size");
        sqlx::query("VACUUM;")
            .execute(conn.as_mut())
            .await
            .expect("vacuum to apply page size");
        sqlx::query("CREATE TABLE t(id INTEGER PRIMARY KEY);")
            .execute(conn.as_mut())
            .await
            .expect("create table");
    }

    let pool = open_pool(&db_path).await;
    let report = run_health_checks(&pool, &db_path)
        .await
        .expect("health check succeeds");
    assert_eq!(report.status, DbHealthStatus::Error);
    let storage = report
        .checks
        .iter()
        .find(|c| c.name == "storage_sanity")
        .expect("storage check present");
    assert!(!storage.passed);
    if let Some(details) = &storage.details {
        assert!(details.contains("page_size"));
    }
}
