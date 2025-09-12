use sqlx::{Row, SqlitePool};
use futures::FutureExt;

use crate::db::run_in_tx;
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
    run_in_tx(pool, |tx| {
        async move {
            sqlx::query("INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
                .bind(&id)
                .bind("Default")
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            Ok::<_, sqlx::Error>(())
        }
        .boxed()
    })
    .await?;
    Ok(id)
}
