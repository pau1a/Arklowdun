use anyhow::Result;
use arklowdun_lib::{
    create_household, default_household_id, delete_household, get_household,
    household_active::{self, StoreHandle},
    list_households, migrate, restore_household, update_household, HouseholdCrudError,
    HouseholdUpdateInput,
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
    migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

#[tokio::test]
async fn delete_active_falls_back_to_default() -> Result<()> {
    let pool = memory_pool().await?;
    let store = StoreHandle::in_memory();
    let default_id = default_household_id(&pool).await?;

    let created = create_household(&pool, "Secondary", None).await?;
    household_active::set_active_household_id(&pool, &store, &created.id).await?;

    let outcome = delete_household(&pool, &created.id, Some(&created.id)).await?;
    assert!(outcome.was_active);
    assert_eq!(outcome.fallback_id.as_deref(), Some(default_id.as_str()));

    let record = get_household(&pool, &created.id)
        .await?
        .expect("created household still present");
    assert!(record.deleted_at.is_some());

    // The helper only signals the fallback; invoking get_active applies the persisted
    // fallback and should now resolve to the default household.
    let active_after = household_active::get_active_household_id(&pool, &store).await?;
    assert_eq!(active_after, default_id);

    Ok(())
}

#[tokio::test]
async fn delete_default_is_rejected() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;
    let err = delete_household(&pool, &default_id, Some(&default_id))
        .await
        .expect_err("default household delete should fail");
    assert!(matches!(err, HouseholdCrudError::DefaultUndeletable));
    Ok(())
}

#[tokio::test]
async fn restore_soft_deleted_household() -> Result<()> {
    let pool = memory_pool().await?;
    let created = create_household(&pool, "Restore", None).await?;
    delete_household(&pool, &created.id, None).await?;

    let restored = restore_household(&pool, &created.id).await?;
    assert!(restored.deleted_at.is_none());
    Ok(())
}

#[tokio::test]
async fn update_rejected_when_deleted() -> Result<()> {
    let pool = memory_pool().await?;
    let created = create_household(&pool, "Target", None).await?;
    delete_household(&pool, &created.id, None).await?;

    let err = update_household(
        &pool,
        &created.id,
        HouseholdUpdateInput {
            name: Some("Renamed"),
            color: None,
        },
    )
    .await
    .expect_err("updates on deleted households should fail");
    assert!(matches!(err, HouseholdCrudError::Deleted));
    Ok(())
}

#[tokio::test]
async fn list_includes_deleted_when_requested() -> Result<()> {
    let pool = memory_pool().await?;
    let active = create_household(&pool, "Active", None).await?;
    let archived = create_household(&pool, "Archived", None).await?;
    delete_household(&pool, &archived.id, None).await?;

    let active_only = list_households(&pool, false).await?;
    assert!(active_only.iter().any(|row| row.id == active.id));
    assert!(active_only.iter().all(|row| row.deleted_at.is_none()));

    let with_deleted = list_households(&pool, true).await?;
    assert!(with_deleted.iter().any(|row| row.id == archived.id));
    assert!(with_deleted
        .into_iter()
        .any(|row| row.id == archived.id && row.deleted_at.is_some()));

    Ok(())
}
