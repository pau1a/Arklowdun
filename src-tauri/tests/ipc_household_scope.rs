use anyhow::Result;
use arklowdun_lib::{commands, default_household_id, migrate, AppError};
use serde_json::{Map, Value};

async fn memory_pool() -> Result<sqlx::SqlitePool> {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

fn assert_scope_violation(err: AppError) {
    assert_eq!(
        err.code(),
        "HOUSEHOLD_NOT_FOUND",
        "unexpected error code for household scope violation: {err:?}"
    );
}

#[tokio::test]
async fn notes_delete_rejects_wrong_household() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)\n         VALUES (?1, ?2, NULL, 0, 0, 0, 0, 'Cross-household note', '#FFFFFF', 0, 0)",
    )
    .bind("note-cross")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    let err = commands::delete_command(&pool, "notes", "wrong-household", "note-cross")
        .await
        .expect_err("expected mismatched household delete to fail");
    assert_scope_violation(err);

    Ok(())
}

#[tokio::test]
async fn notes_delete_rejects_missing_household() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)\n         VALUES (?1, ?2, NULL, 0, 0, 0, 0, 'Missing household note', '#FFFFFF', 0, 0)",
    )
    .bind("note-missing")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    let err = commands::delete_command(&pool, "notes", "", "note-missing")
        .await
        .expect_err("expected delete without household id to fail");
    assert_scope_violation(err);

    Ok(())
}

#[tokio::test]
async fn events_update_rejects_wrong_household() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    sqlx::query(
        "INSERT INTO events (id, title, household_id, created_at, updated_at, tz, start_at_utc)\n         VALUES (?1, 'Scoped event', ?2, 0, 0, 'UTC', 0)",
    )
    .bind("event-cross")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    let mut data = Map::new();
    data.insert("title".into(), Value::String("Updated".into()));

    let err = commands::update_command(
        &pool,
        "events",
        "event-cross",
        data,
        Some("wrong-household"),
    )
    .await
    .expect_err("expected mismatched event update to fail");
    assert_scope_violation(err);

    Ok(())
}

#[tokio::test]
async fn inventory_restore_rejects_wrong_household() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    sqlx::query(
        "INSERT INTO inventory_items (id, household_id, name, created_at, updated_at, deleted_at, position)\n         VALUES (?1, ?2, 'Scoped item', 0, 0, 1, 0)",
    )
    .bind("inventory-cross")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    let err = commands::restore_command(
        &pool,
        "inventory_items",
        "wrong-household",
        "inventory-cross",
    )
    .await
    .expect_err("expected mismatched inventory restore to fail");
    assert_scope_violation(err);

    Ok(())
}

#[tokio::test]
async fn notes_update_rejects_missing_household() -> Result<()> {
    let pool = memory_pool().await?;
    let default_id = default_household_id(&pool).await?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, z, text, color, x, y)\n         VALUES (?1, ?2, NULL, 0, 0, 0, 0, 'Update scope note', '#FFFFFF', 0, 0)",
    )
    .bind("note-update")
    .bind(&default_id)
    .execute(&pool)
    .await?;

    let mut data = Map::new();
    data.insert("text".into(), Value::String("Updated".into()));

    let err = commands::update_command(&pool, "notes", "note-update", data, Some(""))
        .await
        .expect_err("expected update without household id to fail");
    assert_scope_violation(err);

    Ok(())
}
