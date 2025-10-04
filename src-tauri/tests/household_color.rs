use anyhow::Result;
use arklowdun_lib::{
    create_household, default_household_id, get_household, migrate, update_household,
    HouseholdCrudError, HouseholdUpdateInput,
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
async fn migration_exposes_color_column() -> Result<()> {
    let pool = memory_pool().await?;
    let present: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM pragma_table_info('household') WHERE name = 'color'")
            .fetch_optional(&pool)
            .await?;
    assert_eq!(present, Some(1));
    Ok(())
}

#[tokio::test]
async fn update_roundtrips_color() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    let created = create_household(&pool, "Palette", Some("#2563EB")).await?;
    assert_eq!(created.color.as_deref(), Some("#2563EB"));

    let updated = update_household(
        &pool,
        &default_id,
        HouseholdUpdateInput {
            name: None,
            color: Some(Some("#F59E0B")),
        },
    )
    .await?;
    assert_eq!(updated.color.as_deref(), Some("#F59E0B"));

    let cleared = update_household(
        &pool,
        &default_id,
        HouseholdUpdateInput {
            name: None,
            color: Some(None),
        },
    )
    .await?;
    assert_eq!(cleared.color, None);

    let reloaded = get_household(&pool, &default_id)
        .await?
        .expect("household present");
    assert_eq!(reloaded.color, None);

    Ok(())
}

#[tokio::test]
async fn invalid_color_rejected() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    let err = update_household(
        &pool,
        &default_id,
        HouseholdUpdateInput {
            name: None,
            color: Some(Some("#ZZZZZZ")),
        },
    )
    .await
    .expect_err("invalid colors should be rejected");
    assert!(matches!(err, HouseholdCrudError::InvalidColor));

    Ok(())
}
