use sqlx::{Executor, SqlitePool, Row, Column, ValueRef, TypeInfo};
use sqlx::sqlite::SqliteRow;
use serde_json::{Map, Value};

use crate::db::run_in_tx;
use crate::time::now_ms;
use futures::FutureExt;

pub(crate) const DOMAIN_TABLES: &[&str] = &[
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
    "notes",
    "shopping_items",
];

const ORDERED_TABLES: &[&str] = &[
    "bills",
    "policies",
    "property_documents",
    "inventory_items",
    "vehicles",
    "pets",
    "family_members",
    "budget_categories",
    "notes",
    "shopping_items",
];

pub(crate) fn row_to_json(row: SqliteRow) -> Value {
    let mut map = Map::new();
    for col in row.columns() {
        let idx = col.ordinal();
        let v = row.try_get_raw(idx).ok();
        let val = match v {
            Some(raw) => {
                if raw.is_null() {
                    Value::Null
                } else {
                    match raw.type_info().name() {
                        "INTEGER" => row
                            .try_get::<i64, _>(idx)
                            .map(Value::from)
                            .unwrap_or(Value::Null),
                        "REAL" => row
                            .try_get::<f64, _>(idx)
                            .map(Value::from)
                            .unwrap_or(Value::Null),
                        _ => row
                            .try_get::<String, _>(idx)
                            .map(Value::from)
                            .unwrap_or(Value::Null),
                    }
                }
            }
            None => Value::Null,
        };
        map.insert(col.name().to_string(), val);
    }
    Value::Object(map)
}

pub(crate) fn ensure_table(table: &str) -> anyhow::Result<()> {
    if DOMAIN_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(anyhow::anyhow!("invalid table"))
    }
}

pub(crate) fn require_household(id: &str) -> anyhow::Result<&str> {
    if id.is_empty() {
        Err(anyhow::anyhow!("household_id required"))
    } else {
        Ok(id)
    }
}

const ALLOWED_ORDERS: &[&str] = &[
    "z DESC, position, created_at, id",
    "position, created_at, id",
    "created_at, id",
];

// Intentionally kept for test coverage of household scoping.
// Suppress dead_code in non-test builds.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn list_active(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    order_by: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> anyhow::Result<Vec<sqlx::sqlite::SqliteRow>> {
    ensure_table(table)?;
    let household_id = require_household(household_id)?;
    let default_order = if table == "notes" {
        "z DESC, position, created_at, id"
    } else if ORDERED_TABLES.contains(&table) {
        "position, created_at, id"
    } else {
        "created_at, id"
    };
    let order = order_by
        .filter(|ob| ALLOWED_ORDERS.contains(ob))
        .unwrap_or(default_order);

    let where_clause = if table == "household" {
        "WHERE deleted_at IS NULL AND id = ?"
    } else {
        "WHERE deleted_at IS NULL AND household_id = ?"
    };
    let mut sql = format!("SELECT * FROM {table} {where_clause} ORDER BY {order}");
    if limit.is_some() {
        sql.push_str(" LIMIT ?");
    }
    if offset.is_some() {
        sql.push_str(" OFFSET ?");
    }

    let mut query = sqlx::query(&sql).bind(household_id);
    if let Some(l) = limit {
        query = query.bind(l);
    }
    if let Some(o) = offset {
        query = query.bind(o);
    }

    let rows = query.fetch_all(pool).await?;
    Ok(rows)
}

// Intentionally kept for test coverage of household scoping.
// Suppress dead_code in non-test builds.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn first_active(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    order_by: Option<&str>,
) -> anyhow::Result<Option<sqlx::sqlite::SqliteRow>> {
    let household_id = require_household(household_id)?;
    let mut rows = list_active(pool, table, household_id, order_by, Some(1), None).await?;
    Ok(rows.pop())
}

pub(crate) async fn get_active(
    pool: &SqlitePool,
    table: &str,
    household_id: Option<&str>,
    id: &str,
) -> anyhow::Result<Option<sqlx::sqlite::SqliteRow>> {
    ensure_table(table)?;
    let sql;
    let query;
    if table == "household" {
        sql = format!("SELECT * FROM {table} WHERE id = ? AND deleted_at IS NULL");
        query = sqlx::query(&sql).bind(id);
    } else {
        let hh = require_household(household_id.unwrap_or(""))?;
        sql = format!(
            "SELECT * FROM {table} WHERE household_id = ? AND id = ? AND deleted_at IS NULL",
        );
        query = sqlx::query(&sql).bind(hh).bind(id);
    }
    let row = query.fetch_optional(pool).await?;
    Ok(row)
}

pub async fn set_deleted_at(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    id: &str,
) -> anyhow::Result<()> {
    ensure_table(table)?;
    let household_id = require_household(household_id)?;
    let now = now_ms();
    run_in_tx(pool, |tx| {
        async move {
        let res = if table == "household" {
            let sql = format!("UPDATE {table} SET deleted_at = ?, updated_at = ? WHERE id = ?");
            sqlx::query(&sql)
                .bind(now)
                .bind(now)
                .bind(id)
                .execute(&mut *tx)
                .await?
        } else {
            let sql = format!(
                "UPDATE {table} SET deleted_at = ?, updated_at = ? WHERE household_id = ? AND id = ?",
            );
            sqlx::query(&sql)
                .bind(now)
                .bind(now)
                .bind(household_id)
                .bind(id)
                .execute(&mut *tx)
                .await?
        };
        if res.rows_affected() == 0 {
            anyhow::bail!("id not found");
        }
        if table != "household" && ORDERED_TABLES.contains(&table) {
            renumber_positions(&mut *tx, table, household_id).await?;
        }
        Ok::<_, anyhow::Error>(())
        }
        .boxed()
    })
    .await?;
    Ok(())
}

pub async fn clear_deleted_at(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    id: &str,
) -> anyhow::Result<()> {
    ensure_table(table)?;
    let household_id = require_household(household_id)?;
    let now = now_ms();
    run_in_tx(pool, |tx| {
        async move {
        let res = if table == "household" {
            let sql = format!("UPDATE {table} SET deleted_at = NULL, updated_at = ? WHERE id = ?");
            sqlx::query(&sql)
                .bind(now)
                .bind(id)
                .execute(&mut *tx)
                .await?
        } else {
            let sql = format!(
                "UPDATE {table} SET deleted_at = NULL, position = position + 1000000, updated_at = ? WHERE household_id = ? AND id = ?",
            );
            sqlx::query(&sql)
                .bind(now)
                .bind(household_id)
                .bind(id)
                .execute(&mut *tx)
                .await?
        };
        if res.rows_affected() == 0 {
            anyhow::bail!("id not found");
        }
        if table != "household" && ORDERED_TABLES.contains(&table) {
            renumber_positions(&mut *tx, table, household_id).await?;
        }
        Ok::<_, anyhow::Error>(())
        }
        .boxed()
    })
    .await?;
    Ok(())
}

pub async fn renumber_positions<'e, E>(
    exec: E,
    table: &str,
    household_id: &str,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = sqlx::Sqlite>,
{
    ensure_table(table)?;
    let household_id = require_household(household_id)?;
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

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn reorder_positions(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    updates: &[(String, i64)],
) -> anyhow::Result<()> {
    ensure_table(table)?;
    let household_id = require_household(household_id)?;
    run_in_tx(pool, |tx| {
        async move {
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
        Ok::<_, anyhow::Error>(())
        }
        .boxed()
    })
    .await?;
    Ok(())
}


pub mod admin {
    use super::*;
    use sqlx::sqlite::SqliteRow;

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) async fn list_active_for_all_households(
        pool: &SqlitePool,
        table: &str,
        order_by: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> anyhow::Result<Vec<SqliteRow>> {
        ensure_table(table)?;
        let default_order = if table == "notes" {
            "z DESC, position, created_at, id"
        } else if ORDERED_TABLES.contains(&table) {
            "position, created_at, id"
        } else {
            "created_at, id"
        };
        let order = order_by
            .filter(|ob| ALLOWED_ORDERS.contains(ob))
            .unwrap_or(default_order);
        let mut sql =
            format!("SELECT * FROM {table} WHERE deleted_at IS NULL ORDER BY {order}");
        if limit.is_some() {
            sql.push_str(" LIMIT ?");
        }
        if offset.is_some() {
            sql.push_str(" OFFSET ?");
        }
        let mut query = sqlx::query(&sql);
        if let Some(l) = limit {
            query = query.bind(l);
        }
        if let Some(o) = offset {
            query = query.bind(o);
        }
        let rows = query.fetch_all(pool).await?;
        Ok(rows)
    }

    pub(crate) async fn first_active_for_all_households(
        pool: &SqlitePool,
        table: &str,
        order_by: Option<&str>,
    ) -> anyhow::Result<Option<SqliteRow>> {
        let mut rows =
            list_active_for_all_households(pool, table, order_by, Some(1), None).await?;
        Ok(rows.pop())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Row, SqlitePool};

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE events (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, deleted_at INTEGER, created_at INTEGER, updated_at INTEGER)"
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn missing_household_id_errors() {
        let pool = setup_db().await;
        let res = list_active(&pool, "events", "", None, None, None).await;
        assert!(res.is_err());
        assert!(res.err().unwrap().to_string().contains("household_id"));
    }

    #[tokio::test]
    async fn cross_household_isolation() {
        let pool = setup_db().await;
        sqlx::query("INSERT INTO events (id, household_id, created_at, updated_at) VALUES ('a', 'A', 0, 0), ('b', 'B', 0, 0)")
            .execute(&pool)
            .await
            .unwrap();
        let rows_a = list_active(&pool, "events", "A", None, None, None).await.unwrap();
        assert_eq!(rows_a.len(), 1);
        let id_a: String = rows_a[0].try_get("id").unwrap();
        assert_eq!(id_a, "a");

        let first_a = first_active(&pool, "events", "A", None).await.unwrap().unwrap();
        let first_id_a: String = first_a.try_get("id").unwrap();
        assert_eq!(first_id_a, "a");

        let rows_b = list_active(&pool, "events", "B", None, None, None).await.unwrap();
        assert_eq!(rows_b.len(), 1);
        let id_b: String = rows_b[0].try_get("id").unwrap();
        assert_eq!(id_b, "b");

        let first_b = first_active(&pool, "events", "B", None).await.unwrap().unwrap();
        let first_id_b: String = first_b.try_get("id").unwrap();
        assert_eq!(first_id_b, "b");
    }

    #[tokio::test]
    async fn smoke_with_valid_household() {
        let pool = setup_db().await;
        sqlx::query("INSERT INTO events (id, household_id, created_at, updated_at) VALUES ('a', 'A', 0, 0)")
            .execute(&pool)
            .await
            .unwrap();
        let rows = list_active(&pool, "events", "A", None, None, None).await.unwrap();
        assert_eq!(rows.len(), 1);
    }

    async fn setup_ordered_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE bills (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, position INTEGER NOT NULL, deleted_at INTEGER, created_at INTEGER, updated_at INTEGER)"
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn reorder_positions_updates_rows() {
        let pool = setup_ordered_db().await;
        sqlx::query("INSERT INTO bills (id, household_id, position, created_at, updated_at) VALUES ('a','A',0,0,0), ('b','A',1,0,0)")
            .execute(&pool)
            .await
            .unwrap();
        reorder_positions(&pool, "bills", "A", &[("a".into(), 1), ("b".into(), 0)])
            .await
            .unwrap();
        let rows = list_active(&pool, "bills", "A", Some("position, created_at, id"), None, None).await.unwrap();
        let first_id: String = rows[0].try_get("id").unwrap();
        let first_pos: i64 = rows[0].try_get("position").unwrap();
        assert_eq!(first_id, "b");
        assert_eq!(first_pos, 0);
        let second_id: String = rows[1].try_get("id").unwrap();
        let second_pos: i64 = rows[1].try_get("position").unwrap();
        assert_eq!(second_id, "a");
        assert_eq!(second_pos, 1);
    }

    async fn setup_notes_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE notes (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, position INTEGER NOT NULL, z INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER, updated_at INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn soft_delete_and_restore_notes() {
        let pool = setup_notes_db().await;
        sqlx::query("INSERT INTO notes (id, household_id, position, created_at, updated_at) VALUES ('a','H',0,0,0), ('b','H',1,0,0)")
            .execute(&pool)
            .await
            .unwrap();

        set_deleted_at(&pool, "notes", "H", "a").await.unwrap();
        let rows = list_active(&pool, "notes", "H", None, None, None).await.unwrap();
        assert_eq!(rows.len(), 1);
        let id: String = rows[0].try_get("id").unwrap();
        let pos: i64 = rows[0].try_get("position").unwrap();
        assert_eq!(id, "b");
        assert_eq!(pos, 0); // renumbered

        clear_deleted_at(&pool, "notes", "H", "a").await.unwrap();
        let rows = list_active(&pool, "notes", "H", Some("position, created_at, id"), None, None)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        let first_id: String = rows[0].try_get("id").unwrap();
        let first_pos: i64 = rows[0].try_get("position").unwrap();
        let second_id: String = rows[1].try_get("id").unwrap();
        let second_pos: i64 = rows[1].try_get("position").unwrap();
        assert_eq!((first_id, first_pos), ("b".into(), 0));
        assert_eq!((second_id, second_pos), ("a".into(), 1));
    }

}
