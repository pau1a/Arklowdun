use anyhow::Result;
use arklowdun_lib::{migrate, migration_guard};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

async fn setup_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;
    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at) VALUES ('hh', 'Household', 0, 0)",
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}

async fn setup_legacy_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;

    sqlx::query(
        "CREATE TABLE household (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE TABLE events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_at INTEGER,
            end_at INTEGER,
            tz TEXT,
            household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER,
            start_at_utc INTEGER,
            end_at_utc INTEGER
        )",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS events_household_start_at_utc_idx ON events(household_id, start_at_utc)",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS events_household_end_at_utc_idx ON events(household_id, end_at_utc)",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at) VALUES ('hh', 'Household', 0, 0)",
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

#[tokio::test]
async fn guard_detects_pending_events() -> Result<()> {
    let pool = setup_legacy_pool().await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, start_at_utc, household_id, created_at, updated_at)
         VALUES ('evt', 'Test', 0, NULL, 'hh', 0, 0)",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, start_at_utc, end_at, end_at_utc, household_id, created_at, updated_at)
         VALUES ('evt_end', 'Test End', 0, 0, 60000, NULL, 'hh', 0, 0)",
    )
    .execute(&pool)
    .await?;

    migration_guard::ensure_events_indexes(&pool).await?;
    let status = migration_guard::check_events_backfill(&pool).await?;
    assert_eq!(status.total_missing, 2);
    assert_eq!(status.total_missing_start_at_utc, 1);
    assert_eq!(status.total_missing_end_at_utc, 1);
    assert_eq!(status.households.len(), 1);
    let household = &status.households[0];
    assert_eq!(household.missing_start_at_utc, 1);
    assert_eq!(household.missing_end_at_utc, 1);
    assert_eq!(household.missing_total, 2);

    let expected_message = migration_guard::format_guard_failure(&status);
    let err = migration_guard::enforce_events_backfill_guard(&pool)
        .await
        .expect_err("guard should block when UTC values missing");
    assert_eq!(err.to_string(), expected_message);
    Ok(())
}

#[tokio::test]
async fn guard_allows_clean_database() -> Result<()> {
    let pool = setup_pool().await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at_utc, household_id, created_at, updated_at)
         VALUES ('evt', 'Test', 0, 'hh', 0, 0)",
    )
    .execute(&pool)
    .await?;

    migration_guard::ensure_events_indexes(&pool).await?;
    let status = migration_guard::enforce_events_backfill_guard(&pool).await?;
    assert_eq!(status.total_missing, 0);
    assert_eq!(status.total_missing_start_at_utc, 0);
    assert_eq!(status.total_missing_end_at_utc, 0);
    assert!(status.is_ready());
    Ok(())
}
