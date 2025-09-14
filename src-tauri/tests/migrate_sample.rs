use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};
use sqlx::{ConnectOptions, Row, SqlitePool};
use tempfile::tempdir;

use arklowdun_lib::db::apply_migrations;

#[tokio::test]
async fn migrate_fixture_sample_db() -> Result<()> {
    // 1) temp db
    let tmp = tempdir()?;
    let tmp_db = tmp.path().join("sample.runtime.sqlite3");

    // 2) Open a pool with prod-like pragmas
    let pool = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(&tmp_db)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .foreign_keys(true)
            .disable_statement_logging(),
    )
    .await?;

    // 3) Seed pre-migration schema + data from SQL dump
    let sql = include_str!("fixtures/sample.sql");
    for stmt in sql.split(';') {
        let stmt = stmt.trim();
        if stmt.is_empty()
            || stmt.starts_with("--")
            || stmt.contains("schema_migrations")
            || stmt.eq_ignore_ascii_case("BEGIN TRANSACTION")
            || stmt.eq_ignore_ascii_case("COMMIT")
            || stmt.starts_with("PRAGMA")
        {
            continue;
        }
        sqlx::query(stmt).execute(&pool).await?;
    }

    // 4) Run real migrations
    apply_migrations(&pool).await?;

    // 5) Schema assertions
    for t in ["household", "events", "vehicles", "bills"] {
        let name: Option<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table' AND name=?1")
                .bind(t)
                .fetch_optional(&pool)
                .await?;
        assert_eq!(name.as_deref(), Some(t), "expected table {t}");
    }

    // events new columns present
    let cols: Vec<String> = sqlx::query("PRAGMA table_info(events);")
        .fetch_all(&pool)
        .await?
        .into_iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .collect();
    for expected in ["start_at_utc", "tz"] {
        assert!(cols.iter().any(|c| c == expected), "missing `{expected}`");
    }

    // event data preserved
    let start_at: i64 = sqlx::query_scalar("SELECT start_at FROM events WHERE id='e1'")
        .fetch_one(&pool)
        .await?;
    assert_eq!(start_at, 1000);

    // bills positions dense 0-based
    let positions: Vec<i64> = sqlx::query_scalar(
        "SELECT position FROM bills WHERE deleted_at IS NULL ORDER BY position ASC",
    )
    .fetch_all(&pool)
    .await?;
    for (i, p) in positions.iter().enumerate() {
        assert_eq!(*p, i as i64);
    }

    // vehicles backfill check
    let cnt: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM vehicles
         WHERE mot_date IS NOT NULL AND next_mot_due = mot_date
           AND service_date IS NOT NULL AND next_service_due = service_date",
    )
    .fetch_one(&pool)
    .await?;
    assert!(cnt >= 1, "expected next_* backfilled");

    // 6) Integrity checks
    assert!(sqlx::query("PRAGMA foreign_key_check;")
        .fetch_all(&pool)
        .await?
        .is_empty());

    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(integrity, "ok");

    let quick: String = sqlx::query_scalar("PRAGMA quick_check;")
        .fetch_one(&pool)
        .await?;
    assert!(quick == "ok" || quick == "0");

    Ok(())
}
