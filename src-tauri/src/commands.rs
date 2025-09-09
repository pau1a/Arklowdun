use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool, Column, ValueRef, TypeInfo};

use crate::{id::new_uuid_v7, repo, time::now_ms, Event};
use chrono::{NaiveDateTime, LocalResult, TimeZone, Utc, Duration, DateTime, Offset};
use chrono_tz::Tz as ChronoTz;
use rrule::{RRule, RRuleSet, Unvalidated, Tz};

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

pub fn map_db_error(err: sqlx::Error) -> DbErrorPayload {
    map_sqlx_error(err)
}

fn from_local_ms(ms: i64, tz: Tz) -> DateTime<Tz> {
    #[allow(deprecated)]
    let naive = NaiveDateTime::from_timestamp_millis(ms).expect("valid ms");
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(a, _b) => a,
        LocalResult::None => tz
            .offset_from_utc_datetime(&naive)
            .fix()
            .from_utc_datetime(&naive)
            .with_timezone(&tz),
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
) -> Result<Vec<Event>, DbErrorPayload> {
    let hh = repo::require_household(household_id)
        .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })?;
    let rows = sqlx::query_as::<_, Event>(
        r#"
        SELECT id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc,
               rrule, exdates, reminder, created_at, updated_at, deleted_at,
               NULL AS series_parent_id
        FROM events
        WHERE household_id = ? AND deleted_at IS NULL
          AND (
            (rrule IS NULL AND COALESCE(end_at_utc, end_at, start_at) >= ? AND COALESCE(start_at_utc, start_at) <= ?)
            OR rrule IS NOT NULL
          )
        ORDER BY COALESCE(start_at_utc, start_at), id
        "#,
    )
    .bind(hh)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await
    .map_err(|e| DbErrorPayload { code: "Unknown".into(), message: e.to_string() })?;

    const TOTAL_LIMIT: usize = 10_000;
    let mut out = Vec::new();
    'rows: for row in rows {
        if let Some(rrule_str) = row.rrule.clone() {
            let tz_str = row.tz.clone().unwrap_or_else(|| "UTC".into());
            let tz_chrono: ChronoTz = tz_str.parse().unwrap_or(chrono_tz::UTC);
            let tz_name = tz_chrono.name().to_string();
            let tz: Tz = tz_chrono.into();
            let start_local = from_local_ms(row.start_at, tz);
            let duration = row
                .end_at
                .unwrap_or(row.start_at)
                .saturating_sub(row.start_at);
            let rrule_un: Result<RRule<Unvalidated>, _> = rrule_str.parse();
            match rrule_un {
                Ok(rrule_un) => match rrule_un.validate(start_local) {
                    Ok(rrule) => {
                        let mut set = RRuleSet::new(start_local).rrule(rrule);
                        if let Some(exdates_str) = &row.exdates {
                            for ex_s in exdates_str.split(',') {
                                let ex_s = ex_s.trim();
                                if ex_s.is_empty() {
                                    continue;
                                }
                                if let Ok(ex_utc) = DateTime::parse_from_rfc3339(ex_s) {
                                    let ex_local = ex_utc.with_timezone(&Utc).with_timezone(&tz);
                                    set = set.exdate(ex_local);
                                }
                            }
                        }
                        let after = DateTime::<Utc>::from_timestamp_millis(start)
                            .unwrap()
                            .with_timezone(&tz);
                        let before = DateTime::<Utc>::from_timestamp_millis(end)
                            .unwrap()
                            .with_timezone(&tz);
                        set = set.after(after).before(before);
                        for occ in set.all(500).dates {
                            let start_utc_ms = occ.with_timezone(&Utc).timestamp_millis();
                            let end_dt = occ + Duration::milliseconds(duration);
                            let end_utc_ms = end_dt.with_timezone(&Utc).timestamp_millis();
                            if end_utc_ms < start || start_utc_ms > end {
                                continue;
                            }
                            let inst = Event {
                                id: format!("{}::{}", row.id, start_utc_ms),
                                household_id: row.household_id.clone(),
                                title: row.title.clone(),
                                start_at: start_utc_ms,
                                end_at: Some(end_utc_ms),
                                tz: Some(tz_name.clone()),
                                start_at_utc: Some(start_utc_ms),
                                end_at_utc: Some(end_utc_ms),
                                // Instances must look like single events to the UI
                                // so strip recurrence metadata
                                rrule: None,
                                exdates: None,
                                reminder: row.reminder,
                                created_at: row.created_at,
                                updated_at: row.updated_at,
                                deleted_at: None,
                                series_parent_id: Some(row.id.clone()),
                            };
                            out.push(inst);
                            if out.len() >= TOTAL_LIMIT {
                                break 'rows;
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            event_id = %row.id,
                            rule = %rrule_str.chars().take(80).collect::<String>(),
                            "invalid rrule: {e}"
                        );
                    }
                },
                Err(e) => {
                    tracing::warn!(
                        event_id = %row.id,
                        rule = %rrule_str.chars().take(80).collect::<String>(),
                        "failed to parse rrule: {e}"
                    );
                }
            }
        } else {
            let start_utc = row.start_at_utc.unwrap_or(row.start_at);
            let end_utc = row.end_at_utc.or(row.end_at).unwrap_or(row.start_at);
            if end_utc >= start && start_utc <= end {
                out.push(row);
                if out.len() >= TOTAL_LIMIT {
                    break;
                }
            }
        }
    }

    out.sort_by(|a, b| {
        a
            .start_at_utc
            .unwrap_or(a.start_at)
            .cmp(&b.start_at_utc.unwrap_or(b.start_at))
            .then(a.title.cmp(&b.title))
            .then(a.id.cmp(&b.id))
    });

    Ok(out)
}
