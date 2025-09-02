use sqlx::{Executor, SqlitePool};

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


pub async fn renumber_positions<'a, E>(
    exec: E,
    table: &str,
    household_id: &str,
) -> anyhow::Result<()>
where
    E: Executor<'a, Database = sqlx::Sqlite>,
{
    ensure_table(table)?;
    let sql = format!(
        r#"
        WITH ordered AS (
            SELECT id,
                   ROW_NUMBER() OVER (ORDER BY position, created_at, id) - 1 AS new_pos
            FROM {table}
            WHERE household_id = ? AND deleted_at IS NULL
        )
        UPDATE {table}
        SET position = (
            SELECT new_pos FROM ordered WHERE ordered.id = {table}.id
        )
        WHERE id IN (SELECT id FROM ordered)
        "#
    );
    sqlx::query(&sql).bind(household_id).execute(exec).await?;
    Ok(())
}

pub async fn reorder_positions(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    updates: &[(String, i64)],
) -> anyhow::Result<()> {
    ensure_table(table)?;
    let mut tx = pool.begin().await?;
    let now = now_ms();

    let bump_sql = format!(
        "UPDATE {table} \
         SET position = position + 1000000, updated_at = ? \
         WHERE household_id = ? AND deleted_at IS NULL",
    );
    sqlx::query(&bump_sql)
        .bind(now)
        .bind(household_id)
        .execute(&mut *tx)
        .await?;

    let update_sql = format!(
        "UPDATE {table} \
         SET position = ?, updated_at = ? \
         WHERE id = ? AND household_id = ?",
    );
    for (id, pos) in updates {
        sqlx::query(&update_sql)
            .bind(pos)
            .bind(now)
            .bind(id)
            .bind(household_id)
            .execute(&mut *tx)
            .await?;
    }

    renumber_positions(&mut *tx, table, household_id).await?;
    tx.commit().await?;
    Ok(())
}

