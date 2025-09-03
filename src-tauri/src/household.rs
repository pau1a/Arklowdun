use sqlx::{Row, SqlitePool};

use crate::id::new_uuid_v7;
use crate::repo::admin;
use crate::time::now_ms;

pub async fn default_household_id(pool: &SqlitePool) -> anyhow::Result<String> {
    if let Some(row) = admin::first_active_for_all_households(pool, "household", None).await? {
        let id: String = row.try_get("id")?;
        return Ok(id);
    }

    let id = new_uuid_v7();
    let now = now_ms();
    sqlx::query("INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind("Default")
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
    Ok(id)
}
