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

#[tokio::test]
async fn guard_detects_pending_events() -> Result<()> {
    let pool = setup_pool().await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, household_id, created_at, updated_at)
         VALUES ('evt', 'Test', 0, 'hh', 0, 0)",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, start_at_utc, end_at, household_id, created_at, updated_at)
         VALUES ('evt_end', 'Test End', 0, 0, 60000, 'hh', 0, 0)",
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
    let guard = err.downcast::<migration_guard::GuardError>().unwrap();
    assert_eq!(guard.operator_message(), expected_message);
    assert_eq!(guard.user_message(), migration_guard::USER_RECOVERY_MESSAGE);
    Ok(())
}

#[tokio::test]
async fn guard_allows_clean_database() -> Result<()> {
    let pool = setup_pool().await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, start_at_utc, household_id, created_at, updated_at)
         VALUES ('evt', 'Test', 0, 0, 'hh', 0, 0)",
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
