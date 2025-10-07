use std::path::Path;

use anyhow::Result;
use arklowdun_lib::db::health::{run_health_checks, DbHealthStatus};
use arklowdun_lib::{
    default_household_id, delete_household, migrate, pending_cascades, vacuum_queue,
    CascadeDeleteOptions, HouseholdCrudError,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tempfile::tempdir;
#[path = "util.rs"]
mod util;

async fn open_pool(path: &Path) -> Result<SqlitePool> {
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
    Ok(pool)
}

#[tokio::test]
async fn default_delete_does_not_dirty_cascade_state() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("households.sqlite3");
    let pool = open_pool(&db_path).await?;
    let (_vault_guard, vault) = util::temp_vault();

    let default_id = default_household_id(&pool).await?;
    let err = delete_household(
        &pool,
        &vault,
        &default_id,
        Some(&default_id),
        CascadeDeleteOptions::default(),
    )
    .await
    .expect_err("default household delete should fail");
    assert!(matches!(err, HouseholdCrudError::DefaultUndeletable));

    let cascades = pending_cascades(&pool).await?;
    assert!(
        cascades.is_empty(),
        "expected no pending cascades for default household, got {cascades:?}",
    );

    let queue = vacuum_queue(&pool).await?;
    assert!(
        queue.is_empty(),
        "expected no vacuum queue entries for default household, got {queue:?}",
    );

    let report = run_health_checks(&pool, &db_path).await?;
    assert_eq!(report.status, DbHealthStatus::Ok);

    Ok(())
}
