use sqlx::SqlitePool;

use crate::time::now_ms;

const DOMAIN_TABLES: &[&str] = &[
    "household",
    "events",
    "bills",
    "policies",
    "property_documents",
    "inventory_items",
    "vehicles",
    "vehicle_maintenance",
    "pets",
    "pet_medical",
    "family_members",
    "budget_categories",
    "expenses",
];

fn ensure_table(table: &str) -> anyhow::Result<()> {
    if DOMAIN_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(anyhow::anyhow!("invalid table"))
    }
}

pub async fn set_deleted_at(pool: &SqlitePool, table: &str, id: &str) -> anyhow::Result<()> {
    ensure_table(table)?;
    let sql = format!("UPDATE {table} SET deleted_at = ?, updated_at = ? WHERE id = ?");
    let now = now_ms();
    let res = sqlx::query(&sql)
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        anyhow::bail!("id not found");
    }
    Ok(())
}

pub async fn clear_deleted_at(pool: &SqlitePool, table: &str, id: &str) -> anyhow::Result<()> {
    ensure_table(table)?;
    let sql = format!("UPDATE {table} SET deleted_at = NULL, updated_at = ? WHERE id = ?");
    let now = now_ms();
    let res = sqlx::query(&sql)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        anyhow::bail!("id not found");
    }
    Ok(())
}
