use anyhow::Result;
use arklowdun_lib::household_active::{
    get_active_household_id, set_active_household_id, ActiveSetError, StoreHandle,
};
use arklowdun_lib::migrate;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

async fn memory_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

#[tokio::test]
async fn get_active_hydrates_store_with_default() -> Result<()> {
    let pool = memory_pool().await?;
    let store = StoreHandle::in_memory();

    let active = get_active_household_id(&pool, &store).await?;
    let stored = store.snapshot();
    assert_eq!(stored.as_deref(), Some(active.as_str()));

    Ok(())
}

#[tokio::test]
async fn set_active_validates_household_state() -> Result<()> {
    let pool = memory_pool().await?;
    let store = StoreHandle::in_memory();

    let default_id = get_active_household_id(&pool, &store).await?;
    assert!(!default_id.is_empty());

    let valid_id = "hh-valid";
    sqlx::query(
        "INSERT INTO household (id, name, is_default, created_at, updated_at) VALUES (?1, 'Valid', 0, 1, 1)",
    )
    .bind(valid_id)
    .execute(&pool)
    .await?;

    set_active_household_id(&pool, &store, valid_id).await?;
    assert_eq!(store.snapshot().as_deref(), Some(valid_id));

    let missing_err = set_active_household_id(&pool, &store, "hh-missing")
        .await
        .expect_err("missing household should surface error");
    assert!(matches!(missing_err, ActiveSetError::NotFound));

    let deleted_id = "hh-deleted";
    sqlx::query(
        "INSERT INTO household (id, name, is_default, created_at, updated_at, deleted_at) VALUES (?1, 'Deleted', 0, 1, 1, 5)",
    )
    .bind(deleted_id)
    .execute(&pool)
    .await?;

    let deleted_err = set_active_household_id(&pool, &store, deleted_id)
        .await
        .expect_err("deleted household should be rejected");
    assert!(matches!(deleted_err, ActiveSetError::Deleted));

    // Store value remains on last valid id.
    assert_eq!(store.snapshot().as_deref(), Some(valid_id));

    Ok(())
}

#[tokio::test]
async fn get_active_recovers_from_invalid_store_entries() -> Result<()> {
    let pool = memory_pool().await?;
    let store = StoreHandle::in_memory();

    let default_id = get_active_household_id(&pool, &store).await?;

    let transient_id = "hh-transient";
    sqlx::query(
        "INSERT INTO household (id, name, is_default, created_at, updated_at) VALUES (?1, 'Transient', 0, 2, 2)",
    )
    .bind(transient_id)
    .execute(&pool)
    .await?;

    set_active_household_id(&pool, &store, transient_id).await?;

    // Soft-delete and ensure fallback repairs selection.
    sqlx::query("UPDATE household SET deleted_at = 10 WHERE id = ?1")
        .bind(transient_id)
        .execute(&pool)
        .await?;
    let after_deleted = get_active_household_id(&pool, &store).await?;
    assert_eq!(after_deleted, default_id);
    assert_eq!(store.snapshot().as_deref(), Some(default_id.as_str()));

    // Reinsert a fresh household, set it active, then remove it entirely to
    // simulate a missing row.
    sqlx::query("DELETE FROM household WHERE id = ?1")
        .bind(transient_id)
        .execute(&pool)
        .await?;
    sqlx::query(
        "INSERT INTO household (id, name, is_default, created_at, updated_at) VALUES (?1, 'Missing', 0, 3, 3)",
    )
    .bind(transient_id)
    .execute(&pool)
    .await?;
    set_active_household_id(&pool, &store, transient_id).await?;
    sqlx::query("DELETE FROM household WHERE id = ?1")
        .bind(transient_id)
        .execute(&pool)
        .await?;

    let after_missing = get_active_household_id(&pool, &store).await?;
    assert_eq!(after_missing, default_id);
    assert_eq!(store.snapshot().as_deref(), Some(default_id.as_str()));

    Ok(())
}
