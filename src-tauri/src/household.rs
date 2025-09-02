use sqlx::{Row, SqlitePool};

use crate::id::new_uuid_v7;
use crate::repo;
use crate::time::now_ms;

pub async fn default_household_id(pool: &SqlitePool) -> anyhow::Result<String> {
    if let Some(row) = sqlx::query("SELECT id FROM household WHERE deleted_at IS NULL LIMIT 1")
        .fetch_optional(pool)
        .await?
    {
        let id: String = row.try_get("id")?;
        return Ok(id);
    }

    let id = new_uuid_v7();
    let now = now_ms();
    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("Default")
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn delete_household(pool: &SqlitePool, id: &str) -> anyhow::Result<()> {
    repo::set_deleted_at(pool, "household", id).await
}

pub async fn restore_household(pool: &SqlitePool, id: &str) -> anyhow::Result<()> {
    repo::clear_deleted_at(pool, "household", id).await
}
