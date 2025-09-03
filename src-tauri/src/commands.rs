use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool, Column, ValueRef, TypeInfo};

use crate::{id::new_uuid_v7, repo, time::now_ms};

#[derive(Debug, Serialize, Deserialize)]
pub struct DbErrorPayload {
    pub code: String,
    pub message: String,
}

fn map_sqlx_error(err: sqlx::Error) -> DbErrorPayload {
    if let sqlx::Error::Database(db) = &err {
        if let Some(code) = db.code() {
            // SQLite constraint violations have extended code 2067
            if code == "2067" || code == "1555" || code == "19" {
                return DbErrorPayload {
                    code: "Constraint".into(),
                    message: db.message().to_string(),
                };
            }
        }
    }
    DbErrorPayload {
        code: "Unknown".into(),
        message: err.to_string(),
    }
}

fn row_to_value(row: SqliteRow) -> Value {
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

async fn list(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    order_by: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> anyhow::Result<Vec<Value>> {
    let rows = repo::list_active(pool, table, household_id, order_by, limit, offset).await?;
    Ok(rows.into_iter().map(row_to_value).collect())
}

async fn get(
    pool: &SqlitePool,
    table: &str,
    household_id: Option<&str>,
    id: &str,
) -> anyhow::Result<Option<Value>> {
    let row = repo::get_active(pool, table, household_id, id).await?;
    Ok(row.map(row_to_value))
}

async fn create(
    pool: &SqlitePool,
    table: &str,
    mut data: Map<String, Value>,
) -> Result<Value, sqlx::Error> {
    let id = data
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(new_uuid_v7);
    data.insert("id".into(), Value::String(id.clone()));
    let now = now_ms();
    data.entry(String::from("created_at")).or_insert(Value::from(now));
    data.insert("updated_at".into(), Value::from(now));

    let cols: Vec<String> = data.keys().cloned().collect();
    let placeholders: Vec<String> = cols.iter().map(|_| "?".into()).collect();
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        cols.join(","),
        placeholders.join(",")
    );
    let mut query = sqlx::query(&sql);
    for c in &cols {
        let v = data.get(c).unwrap();
        query = bind_value(query, v);
    }
    query.execute(pool).await?;
    Ok(Value::Object(data))
}

async fn update(
    pool: &SqlitePool,
    table: &str,
    id: &str,
    mut data: Map<String, Value>,
    household_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    data.remove("id");
    data.remove("created_at");
    let now = now_ms();
    data.insert("updated_at".into(), Value::from(now));
    let cols: Vec<String> = data.keys().cloned().collect();
    let set_clause: Vec<String> = cols.iter().map(|c| format!("{c} = ?")).collect();
    let sql = if table == "household" {
        format!(
            "UPDATE {table} SET {} WHERE id = ?",
            set_clause.join(",")
        )
    } else {
        format!(
            "UPDATE {table} SET {} WHERE household_id = ? AND id = ?",
            set_clause.join(",")
        )
    };
    let mut query = sqlx::query(&sql);
    for c in &cols {
        let v = data.get(c).unwrap();
        query = bind_value(query, v);
    }
    if table == "household" {
        query = query.bind(id);
    } else {
        let hh = household_id.unwrap_or("");
        query = query.bind(hh).bind(id);
    }
    query.execute(pool).await?;
    Ok(())
}

fn bind_value<'q>(q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, v: &Value) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        Value::Null => q.bind(Option::<i64>::None),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else if let Some(f) = n.as_f64() {
                q.bind(f)
            } else {
                q.bind(Option::<i64>::None)
            }
        }
        Value::Bool(b) => q.bind(*b as i64),
        Value::String(s) => q.bind(s.clone()),
        _ => q.bind(v.to_string()),
    }
}

pub async fn list_command(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    order_by: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Value>, DbErrorPayload> {
    list(pool, table, household_id, order_by, limit, offset)
        .await
        .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })
}

pub async fn get_command(
    pool: &SqlitePool,
    table: &str,
    household_id: Option<&str>,
    id: &str,
) -> Result<Option<Value>, DbErrorPayload> {
    get(pool, table, household_id, id)
        .await
        .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })
}

pub async fn create_command(
    pool: &SqlitePool,
    table: &str,
    data: Map<String, Value>,
) -> Result<Value, DbErrorPayload> {
    create(pool, table, data).await.map_err(map_sqlx_error)
}

pub async fn update_command(
    pool: &SqlitePool,
    table: &str,
    id: &str,
    data: Map<String, Value>,
    household_id: Option<&str>,
) -> Result<(), DbErrorPayload> {
    update(pool, table, id, data, household_id)
        .await
        .map_err(map_sqlx_error)
}

pub async fn delete_command(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    id: &str,
) -> Result<(), DbErrorPayload> {
    repo::set_deleted_at(pool, table, household_id, id)
        .await
        .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })
}

pub async fn restore_command(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    id: &str,
) -> Result<(), DbErrorPayload> {
    repo::clear_deleted_at(pool, table, household_id, id)
        .await
        .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })
}

pub async fn events_list_range_command(
    pool: &SqlitePool,
    household_id: &str,
    start: i64,
    end: i64,
) -> Result<Vec<Value>, DbErrorPayload> {
    let hh = repo::require_household(household_id)
        .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })?;
    let rows = sqlx::query(
        "SELECT * FROM events WHERE household_id = ? AND deleted_at IS NULL AND starts_at >= ? AND starts_at < ? ORDER BY starts_at, id",
    )
    .bind(hh)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await
    .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })?;
    Ok(rows.into_iter().map(row_to_value).collect())
}
