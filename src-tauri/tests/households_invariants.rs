use anyhow::Result;
use arklowdun_lib::{
    assert_household_active,
    ensure_household_invariants,
    HouseholdGuardError,
    migrate,
};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

async fn memory_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    Ok(pool)
}

#[tokio::test]
async fn migration_establishes_single_default() -> Result<()> {
    let pool = memory_pool().await?;
    migrate::apply_migrations(&pool).await?;

    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM household WHERE is_default = 1")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1, "exactly one household is default after migration");
    Ok(())
}

#[tokio::test]
async fn ensure_invariants_recovers_zero_default() -> Result<()> {
    let pool = memory_pool().await?;
    sqlx::query(
        "CREATE TABLE household (\
             id TEXT PRIMARY KEY,\
             created_at INTEGER,\
             deleted_at INTEGER,\
             is_default INTEGER NOT NULL DEFAULT 0\
         )",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO household (id, created_at, deleted_at, is_default) VALUES\
             ('a', 1, NULL, 0), ('b', 2, NULL, 0)",
    )
    .execute(&pool)
    .await?;

    ensure_household_invariants(&pool).await?;

    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT id, is_default FROM household ORDER BY created_at, id")
            .fetch_all(&pool)
            .await?;
    assert_eq!(rows[0], ("a".into(), 1));
    assert_eq!(rows[1], ("b".into(), 0));
    Ok(())
}

#[tokio::test]
async fn ensure_invariants_trims_multiple_defaults() -> Result<()> {
    let pool = memory_pool().await?;
    sqlx::query(
        "CREATE TABLE household (\
             id TEXT PRIMARY KEY,\
             created_at INTEGER,\
             deleted_at INTEGER,\
             is_default INTEGER NOT NULL DEFAULT 0\
         )",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO household (id, created_at, deleted_at, is_default) VALUES\
             ('a', 10, NULL, 1), ('b', 5, NULL, 1), ('c', 20, NULL, 0)",
    )
    .execute(&pool)
    .await?;

    ensure_household_invariants(&pool).await?;

    let defaults: Vec<String> =
        sqlx::query_scalar("SELECT id FROM household WHERE is_default = 1 ORDER BY id")
            .fetch_all(&pool)
            .await?;
    assert_eq!(defaults, vec!["b".to_string()]);
    Ok(())
}

#[tokio::test]
async fn triggers_block_deleting_default_household() -> Result<()> {
    let pool = memory_pool().await?;
    migrate::apply_migrations(&pool).await?;

    let err = sqlx::query("DELETE FROM household WHERE is_default = 1")
        .execute(&pool)
        .await
        .expect_err("deleting default household must fail");
    assert!(
        err.to_string().contains("default_household_undeletable"),
        "error mentions trigger guard"
    );
    Ok(())
}

#[tokio::test]
async fn triggers_block_soft_delete_of_default_household() -> Result<()> {
    let pool = memory_pool().await?;
    migrate::apply_migrations(&pool).await?;

    let err = sqlx::query("UPDATE household SET deleted_at = 123 WHERE is_default = 1")
        .execute(&pool)
        .await
        .expect_err("soft deleting default household must fail");
    assert!(
        err.to_string().contains("default_household_undeletable"),
        "error mentions trigger guard"
    );
    Ok(())
}

#[tokio::test]
async fn guard_detects_soft_deleted_household() -> Result<()> {
    let pool = memory_pool().await?;
    sqlx::query(
        "CREATE TABLE household (\
             id TEXT PRIMARY KEY,\
             deleted_at INTEGER,\
             is_default INTEGER NOT NULL DEFAULT 0\
         )",
    )
    .execute(&pool)
    .await?;
    sqlx::query("INSERT INTO household (id, deleted_at, is_default) VALUES ('hh', 10, 0)")
        .execute(&pool)
        .await?;

    let err = assert_household_active(&pool, "hh")
        .await
        .expect_err("soft-deleted household should be rejected");
    assert_eq!(err, HouseholdGuardError::Deleted);
    Ok(())
}

#[tokio::test]
async fn guard_reports_missing_household() -> Result<()> {
    let pool = memory_pool().await?;
    sqlx::query(
        "CREATE TABLE household (\
             id TEXT PRIMARY KEY,\
             deleted_at INTEGER,\
             is_default INTEGER NOT NULL DEFAULT 0\
         )",
    )
    .execute(&pool)
    .await?;

    let err = assert_household_active(&pool, "missing")
        .await
        .expect_err("missing household should surface NotFound");
    assert_eq!(err, HouseholdGuardError::NotFound);
    Ok(())
}
