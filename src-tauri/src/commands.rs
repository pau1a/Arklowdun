use serde_json::{Map, Value};
use sqlx::{sqlite::SqliteRow, Column, Row, SqlitePool, TypeInfo, ValueRef};

use crate::{
    exdate::{inspect_exdates, parse_rrule_until, split_csv_exdates, ExdateContext},
    id::new_uuid_v7,
    repo,
    time::now_ms,
    time_errors::TimeErrorCode,
    time_shadow::{
        detect_legacy_event_columns, LegacyEventColumns, ShadowAudit, ShadowAuditSkipReason,
    },
    AppError, AppResult, Event, EventsListRangeResponse,
};
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz as ChronoTz;
use rrule::{RRule, RRuleSet, Tz, Unvalidated};

#[allow(clippy::result_large_err)]
#[derive(Debug, Clone, sqlx::FromRow)]
struct EventRow {
    id: String,
    household_id: String,
    title: String,
    /// Legacy wall-clock fields become `NULL` projections once the schema drops
    /// them, so they remain optional even when the historical table declared
    /// them `NOT NULL`.
    legacy_start_at: Option<i64>,
    legacy_end_at: Option<i64>,
    tz: Option<String>,
    start_at_utc: i64,
    end_at_utc: Option<i64>,
    rrule: Option<String>,
    exdates: Option<String>,
    reminder: Option<i64>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

impl From<&EventRow> for Event {
    fn from(row: &EventRow) -> Self {
        Event {
            id: row.id.clone(),
            household_id: row.household_id.clone(),
            title: row.title.clone(),
            tz: row.tz.clone(),
            start_at_utc: row.start_at_utc,
            end_at_utc: row.end_at_utc,
            rrule: row.rrule.clone(),
            exdates: row.exdates.clone(),
            reminder: row.reminder,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            series_parent_id: None,
        }
    }
}

fn parse_timezone_name(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

#[allow(clippy::result_large_err)]
fn canonicalize_timezone(tz_name: Option<String>) -> AppResult<(ChronoTz, String)> {
    let name = tz_name.unwrap_or_else(|| "UTC".to_string());
    let parsed: ChronoTz = name.parse().map_err(|_| {
        TimeErrorCode::TimezoneUnknown
            .into_error()
            .with_context("timezone", name.clone())
    })?;
    Ok((parsed, parsed.name().to_string()))
}

#[allow(clippy::result_large_err)]
fn local_wallclock_ms(ms: i64, tz: &ChronoTz, field: &'static str) -> AppResult<i64> {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .ok_or_else(|| {
            AppError::new("TIME/INVALID_TIMESTAMP", "Invalid UTC timestamp")
                .with_context("field", field)
                .with_context("timestamp", ms.to_string())
        })
        .map(|dt| {
            // This intentionally inverts `time_shadow::local_ms_to_utc` so DST
            // ambiguities round-trip the same way while the legacy columns still
            // exist.
            dt.with_timezone(tz)
                .naive_local()
                .and_utc()
                .timestamp_millis()
        })
}

#[allow(clippy::result_large_err)]
fn derive_event_wall_clock_for_create(data: &mut Map<String, Value>) -> AppResult<()> {
    let legacy_start_present = data.contains_key("start_at");
    let legacy_end_present = data.contains_key("end_at");
    if legacy_start_present || legacy_end_present {
        let event_id = data
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        tracing::debug!(
            target: "arklowdun",
            event = "event_legacy_fields_sanitized",
            context = "create",
            event_id = %event_id.as_deref().unwrap_or(""),
            legacy_start_present,
            legacy_end_present,
            "legacy wall-clock fields sanitized in create payload"
        );
    }

    let tz_name = parse_timezone_name(data.get("tz"));
    let (tz, canonical) = canonicalize_timezone(tz_name)?;
    data.insert("tz".into(), Value::String(canonical));

    let start_at_utc = value_to_i64(data.get("start_at_utc")).ok_or_else(|| {
        AppError::new(
            "TIME/MISSING_START_AT_UTC",
            "Events must include a UTC start timestamp.",
        )
        .with_context("field", "start_at_utc")
    })?;
    let local_start = local_wallclock_ms(start_at_utc, &tz, "start_at_utc")?;
    data.insert("start_at".into(), Value::from(local_start));

    match value_to_i64(data.get("end_at_utc")) {
        Some(end_utc) => {
            let local_end = local_wallclock_ms(end_utc, &tz, "end_at_utc")?;
            data.insert("end_at".into(), Value::from(local_end));
        }
        None => {
            data.remove("end_at");
        }
    }

    Ok(())
}

async fn derive_event_wall_clock_for_update(
    pool: &SqlitePool,
    household_id: &str,
    event_id: &str,
    data: &mut Map<String, Value>,
) -> AppResult<()> {
    let touches_time = data.contains_key("start_at_utc")
        || data.contains_key("end_at_utc")
        || data.contains_key("tz")
        || data.contains_key("start_at")
        || data.contains_key("end_at");
    if !touches_time {
        return Ok(());
    }

    let legacy_start = data.remove("start_at");
    let legacy_end = data.remove("end_at");
    if legacy_start.is_some() || legacy_end.is_some() {
        tracing::debug!(
            target: "arklowdun",
            event = "event_legacy_fields_sanitized",
            context = "update",
            household_id = %household_id,
            event_id = %event_id,
            legacy_start_present = legacy_start.is_some(),
            legacy_end_present = legacy_end.is_some(),
            "legacy wall-clock fields sanitized in update payload"
        );
    }

    let existing = repo::get_active(pool, "events", Some(household_id), event_id)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "events_wall_clock")
                .with_context("household_id", household_id.to_string())
                .with_context("event_id", event_id.to_string())
        })?;

    let mut existing_tz_raw: Option<String> = None;
    let mut existing_start_at_utc: Option<i64> = None;
    let mut existing_end_at_utc: Option<i64> = None;
    if let Some(row) = existing {
        existing_tz_raw = row.try_get("tz").ok();
        existing_start_at_utc = row.try_get("start_at_utc").ok();
        existing_end_at_utc = row.try_get("end_at_utc").ok();
    }

    let tz_name_override = parse_timezone_name(data.get("tz"));
    let existing_tz_canonical = existing_tz_raw.clone().and_then(|tz| {
        let trimmed = tz.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    let tz_input = tz_name_override.clone().or(existing_tz_canonical);
    let defaulted_timezone = tz_input.is_none();
    let (tz, canonical) = canonicalize_timezone(tz_input)?;
    if data.contains_key("tz") {
        data.insert("tz".into(), Value::String(canonical.clone()));
    }
    if defaulted_timezone {
        tracing::debug!(
            target: "arklowdun",
            event = "event_timezone_defaulted",
            household_id = %household_id,
            event_id = %event_id,
            fallback = %canonical,
            had_existing_tz = existing_tz_raw.is_some(),
            tz_override_present = tz_name_override.is_some(),
            "defaulting timezone for wall-clock derivation"
        );
    }

    let start_at_utc = value_to_i64(data.get("start_at_utc"))
        .or(existing_start_at_utc)
        .ok_or_else(|| {
            AppError::new(
                "TIME/MISSING_START_AT_UTC",
                "Events must include a UTC start timestamp.",
            )
            .with_context("field", "start_at_utc")
            .with_context("event_id", event_id.to_string())
        })?;
    let local_start = local_wallclock_ms(start_at_utc, &tz, "start_at_utc")?;
    data.insert("start_at".into(), Value::from(local_start));

    let end_at_utc = value_to_i64(data.get("end_at_utc")).or(existing_end_at_utc);
    match end_at_utc {
        Some(end_utc) => {
            let local_end = local_wallclock_ms(end_utc, &tz, "end_at_utc")?;
            data.insert("end_at".into(), Value::from(local_end));
        }
        None => {
            if data.contains_key("end_at_utc") {
                data.insert("end_at".into(), Value::Null);
            }
        }
    }

    Ok(())
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

fn value_to_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f.trunc() as i64)),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

#[allow(clippy::result_large_err)]
fn optional_string(value: Option<&Value>, field: &'static str) -> AppResult<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(_) => Err(TimeErrorCode::ExdateInvalidFormat
            .into_error()
            .with_context("field", field)),
    }
}

#[allow(clippy::result_large_err)]
fn parse_exdate_input(value: &Value) -> AppResult<Vec<String>> {
    match value {
        Value::Null => Ok(Vec::new()),
        Value::String(raw) => Ok(split_csv_exdates(raw)),
        Value::Array(items) => {
            let mut out = Vec::new();
            for item in items {
                match item {
                    Value::Null => {}
                    Value::String(s) => {
                        let trimmed = s.trim();
                        if !trimmed.is_empty() {
                            out.push(trimmed.to_string());
                        }
                    }
                    _ => {
                        return Err(TimeErrorCode::ExdateInvalidFormat
                            .into_error()
                            .with_context("field", "exdates"));
                    }
                }
            }
            Ok(out)
        }
        _ => Err(TimeErrorCode::ExdateInvalidFormat
            .into_error()
            .with_context("field", "exdates")),
    }
}

#[allow(clippy::result_large_err)]
fn ensure_start_datetime(start_ms: Option<i64>, event_id: &str) -> AppResult<DateTime<Utc>> {
    let ms = start_ms.ok_or_else(|| {
        TimeErrorCode::ExdateOutOfRange
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("reason", "missing_start_timestamp")
    })?;
    DateTime::<Utc>::from_timestamp_millis(ms).ok_or_else(|| {
        TimeErrorCode::ExdateOutOfRange
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("start_ms", ms.to_string())
            .with_context("reason", "invalid_start_timestamp")
    })
}

#[allow(clippy::result_large_err)]
fn normalize_event_exdates_for_create(data: &mut Map<String, Value>) -> AppResult<()> {
    let Some(exdates_value) = data.get("exdates").cloned() else {
        return Ok(());
    };
    let event_id = data.get("id").and_then(|v| v.as_str()).unwrap_or("new");

    let entries = parse_exdate_input(&exdates_value)?;
    if entries.is_empty() {
        data.insert("exdates".into(), Value::Null);
        return Ok(());
    }

    let start_ms =
        value_to_i64(data.get("start_at_utc")).or_else(|| value_to_i64(data.get("start_at")));
    let start = ensure_start_datetime(start_ms, event_id)?;
    let rrule = optional_string(data.get("rrule"), "rrule")?;
    let rrule = rrule.ok_or_else(|| {
        TimeErrorCode::ExdateOutOfRange
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("reason", "missing_rrule")
    })?;
    let until = parse_rrule_until(&rrule);
    let context = ExdateContext {
        start: Some(start),
        until,
    };
    let inspection = inspect_exdates(entries, &context);
    if inspection.invalid_total() > 0 {
        let sample = inspection
            .invalid_format
            .first()
            .or_else(|| inspection.non_utc.first())
            .cloned()
            .unwrap_or_default();
        return Err(TimeErrorCode::ExdateInvalidFormat
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("invalid_value", sample));
    }
    if !inspection.out_of_range.is_empty() {
        return Err(TimeErrorCode::ExdateOutOfRange
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("out_of_range", inspection.out_of_range.join(",")));
    }

    match inspection.canonical {
        Some(canonical) => {
            data.insert("exdates".into(), Value::String(canonical));
        }
        None => {
            data.insert("exdates".into(), Value::Null);
        }
    }
    Ok(())
}

async fn normalize_event_exdates_for_update(
    pool: &SqlitePool,
    household_id: &str,
    event_id: &str,
    data: &mut Map<String, Value>,
) -> AppResult<()> {
    let Some(exdates_value) = data.get("exdates").cloned() else {
        return Ok(());
    };

    let entries = parse_exdate_input(&exdates_value)?;
    if entries.is_empty() {
        data.insert("exdates".into(), Value::Null);
        return Ok(());
    }

    let existing = repo::get_active(pool, "events", Some(household_id), event_id)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("table", "events")
                .with_context("id", event_id.to_string())
                .with_context("household_id", household_id.to_string())
        })?;
    let mut existing_start_at = None;
    let mut existing_start_at_utc = None;
    let mut existing_rrule: Option<String> = None;
    if let Some(row) = existing {
        existing_start_at = row.try_get("start_at").ok();
        existing_start_at_utc = row.try_get("start_at_utc").ok();
        existing_rrule = row.try_get("rrule").ok();
    }

    let start_ms = value_to_i64(data.get("start_at_utc"))
        .or_else(|| value_to_i64(data.get("start_at")))
        .or(existing_start_at_utc)
        .or(existing_start_at);
    let start = ensure_start_datetime(start_ms, event_id)?;

    let incoming_rrule = optional_string(data.get("rrule"), "rrule")?;
    let final_rrule = incoming_rrule.or_else(|| {
        existing_rrule
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });
    let rrule = final_rrule.ok_or_else(|| {
        TimeErrorCode::ExdateOutOfRange
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("household_id", household_id.to_string())
            .with_context("reason", "missing_rrule")
    })?;
    let until = parse_rrule_until(&rrule);
    let context = ExdateContext {
        start: Some(start),
        until,
    };
    let inspection = inspect_exdates(entries, &context);
    if inspection.invalid_total() > 0 {
        let sample = inspection
            .invalid_format
            .first()
            .or_else(|| inspection.non_utc.first())
            .cloned()
            .unwrap_or_default();
        return Err(TimeErrorCode::ExdateInvalidFormat
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("household_id", household_id.to_string())
            .with_context("invalid_value", sample));
    }
    if !inspection.out_of_range.is_empty() {
        return Err(TimeErrorCode::ExdateOutOfRange
            .into_error()
            .with_context("event_id", event_id.to_string())
            .with_context("household_id", household_id.to_string())
            .with_context("out_of_range", inspection.out_of_range.join(",")));
    }

    match inspection.canonical {
        Some(canonical) => {
            data.insert("exdates".into(), Value::String(canonical));
        }
        None => {
            data.insert("exdates".into(), Value::Null);
        }
    }
    Ok(())
}

async fn list(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    order_by: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<Value>> {
    let rows = repo::list_active(pool, table, household_id, order_by, limit, offset)
        .await
        .map_err(AppError::from)?;
    Ok(rows.into_iter().map(row_to_value).collect())
}

async fn get(
    pool: &SqlitePool,
    table: &str,
    household_id: Option<&str>,
    id: &str,
) -> AppResult<Option<Value>> {
    let row = repo::get_active(pool, table, household_id, id)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(row_to_value))
}

// TXN: domain=OUT OF SCOPE tables=*
async fn create(pool: &SqlitePool, table: &str, mut data: Map<String, Value>) -> AppResult<Value> {
    let id = data
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(new_uuid_v7);
    data.insert("id".into(), Value::String(id.clone()));
    let now = now_ms();
    data.entry(String::from("created_at"))
        .or_insert(Value::from(now));
    data.insert("updated_at".into(), Value::from(now));

    if table == "events" {
        derive_event_wall_clock_for_create(&mut data)?;
        normalize_event_exdates_for_create(&mut data)?;
    }

    let cols: Vec<String> = data.keys().cloned().collect();
    let placeholders: Vec<String> = cols.iter().map(|_| "?".into()).collect();
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        cols.join(","),
        placeholders.join(",")
    );
    let mut query = sqlx::query(&sql);
    for c in &cols {
        let value = data.get(c).ok_or_else(|| {
            AppError::new("COMMANDS/MISSING_FIELD", "Payload missing value for column")
                .with_context("column", c.clone())
        })?;
        query = bind_value(query, value);
    }
    query.execute(pool).await.map_err(AppError::from)?;
    Ok(Value::Object(data))
}

// TXN: domain=OUT OF SCOPE tables=*
async fn update(
    pool: &SqlitePool,
    table: &str,
    id: &str,
    mut data: Map<String, Value>,
    household_id: Option<&str>,
) -> AppResult<()> {
    if table == "events" {
        let hh = household_id.ok_or_else(|| {
            AppError::new(
                "COMMANDS/MISSING_FIELD",
                "Household is required when updating events.",
            )
        })?;
        normalize_event_exdates_for_update(pool, hh, id, &mut data).await?;
        derive_event_wall_clock_for_update(pool, hh, id, &mut data).await?;
    }
    data.remove("id");
    data.remove("created_at");
    let now = now_ms();
    data.insert("updated_at".into(), Value::from(now));
    let cols: Vec<String> = data.keys().cloned().collect();
    let set_clause: Vec<String> = cols.iter().map(|c| format!("{c} = ?")).collect();
    let sql = if table == "household" {
        format!("UPDATE {table} SET {} WHERE id = ?", set_clause.join(","))
    } else {
        format!(
            "UPDATE {table} SET {} WHERE household_id = ? AND id = ?",
            set_clause.join(",")
        )
    };
    let mut query = sqlx::query(&sql);
    for c in &cols {
        let value = data.get(c).ok_or_else(|| {
            AppError::new("COMMANDS/MISSING_FIELD", "Payload missing value for column")
                .with_context("column", c.clone())
        })?;
        query = bind_value(query, value);
    }
    if table == "household" {
        query = query.bind(id);
    } else {
        let hh = household_id.unwrap_or("");
        query = query.bind(hh).bind(id);
    }
    query.execute(pool).await.map_err(AppError::from)?;
    Ok(())
}

fn bind_value<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
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
) -> AppResult<Vec<Value>> {
    list(pool, table, household_id, order_by, limit, offset)
        .await
        .map_err(|err| {
            err.with_context("operation", "list")
                .with_context("table", table.to_string())
                .with_context("household_id", household_id.to_string())
        })
}

pub async fn get_command(
    pool: &SqlitePool,
    table: &str,
    household_id: Option<&str>,
    id: &str,
) -> AppResult<Option<Value>> {
    get(pool, table, household_id, id).await.map_err(|err| {
        let household = household_id.unwrap_or("");
        err.with_context("operation", "get")
            .with_context("table", table.to_string())
            .with_context("household_id", household.to_string())
            .with_context("id", id.to_string())
    })
}

// TXN: domain=OUT OF SCOPE tables=*
pub async fn create_command(
    pool: &SqlitePool,
    table: &str,
    data: Map<String, Value>,
) -> AppResult<Value> {
    create(pool, table, data).await.map_err(|err| {
        err.with_context("operation", "create")
            .with_context("table", table.to_string())
    })
}

// TXN: domain=OUT OF SCOPE tables=*
pub async fn update_command(
    pool: &SqlitePool,
    table: &str,
    id: &str,
    data: Map<String, Value>,
    household_id: Option<&str>,
) -> AppResult<()> {
    update(pool, table, id, data, household_id)
        .await
        .map_err(|err| {
            let household = household_id.unwrap_or("");
            err.with_context("operation", "update")
                .with_context("table", table.to_string())
                .with_context("household_id", household.to_string())
                .with_context("id", id.to_string())
        })
}

// TXN: domain=OUT OF SCOPE tables=*
pub async fn delete_command(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    id: &str,
) -> AppResult<()> {
    if table == "inventory_items" || table == "shopping_items" {
        return repo::items::delete_item(pool, table, household_id, id)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "delete")
                    .with_context("table", table.to_string())
                    .with_context("household_id", household_id.to_string())
                    .with_context("id", id.to_string())
            });
    }
    repo::set_deleted_at(pool, table, household_id, id)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "delete")
                .with_context("table", table.to_string())
                .with_context("household_id", household_id.to_string())
                .with_context("id", id.to_string())
        })
}

// TXN: domain=OUT OF SCOPE tables=*
pub async fn restore_command(
    pool: &SqlitePool,
    table: &str,
    household_id: &str,
    id: &str,
) -> AppResult<()> {
    if table == "inventory_items" || table == "shopping_items" {
        return repo::items::restore_item(pool, table, household_id, id)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "restore")
                    .with_context("table", table.to_string())
                    .with_context("household_id", household_id.to_string())
                    .with_context("id", id.to_string())
            });
    }
    repo::clear_deleted_at(pool, table, household_id, id)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "restore")
                .with_context("table", table.to_string())
                .with_context("household_id", household_id.to_string())
                .with_context("id", id.to_string())
        })
}

pub async fn events_list_range_command(
    pool: &SqlitePool,
    household_id: &str,
    start: i64,
    end: i64,
) -> AppResult<EventsListRangeResponse> {
    let hh = repo::require_household(household_id)
        .map_err(|err| AppError::from(err).with_context("operation", "events_list_range"))?;
    let mut shadow_audit = ShadowAudit::new();

    let (legacy_start_projection, legacy_end_projection) =
        match detect_legacy_event_columns(pool).await {
            Ok(cols) => {
                if !cols.has_full_legacy() {
                    shadow_audit.skip(ShadowAuditSkipReason::MissingLegacyColumns, cols);
                }
                (
                    if cols.has_start_at {
                        "start_at".to_string()
                    } else {
                        "NULL".to_string()
                    },
                    if cols.has_end_at {
                        "end_at".to_string()
                    } else {
                        "NULL".to_string()
                    },
                )
            }
            Err(err) => {
                tracing::debug!(
                    target: "arklowdun",
                    event = "time_shadow_column_probe_failed",
                    error = %err
                );
                shadow_audit.skip(
                    ShadowAuditSkipReason::ColumnProbeFailed,
                    LegacyEventColumns::default(),
                );
                ("NULL".to_string(), "NULL".to_string())
            }
        };

    // NOTE: Only fixed column names or NULL placeholders are interpolated here; all
    // caller-provided values remain bound parameters below.
    let query = format!(
        r#"
        SELECT id,
               household_id,
               title,
               {legacy_start} AS legacy_start_at,
               {legacy_end} AS legacy_end_at,
               tz,
               start_at_utc,
               end_at_utc,
               rrule,
               exdates,
               reminder,
               created_at,
               updated_at,
               deleted_at
        FROM events
        WHERE household_id = ? AND deleted_at IS NULL
          AND start_at_utc IS NOT NULL
          AND (
            (rrule IS NULL AND COALESCE(end_at_utc, start_at_utc) >= ? AND start_at_utc <= ?)
            OR rrule IS NOT NULL
          )
        ORDER BY start_at_utc, id
        "#,
        legacy_start = legacy_start_projection,
        legacy_end = legacy_end_projection,
    );

    let rows = sqlx::query_as::<_, EventRow>(&query)
        .bind(hh)
        .bind(start)
        .bind(end)
        .fetch_all(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "events_list_range")
                .with_context("household_id", household_id.to_string())
                .with_context("start", start.to_string())
                .with_context("end", end.to_string())
        })?;

    const PER_SERIES_LIMIT: usize = 500;
    const TOTAL_LIMIT: usize = 10_000;
    let range_start_utc = DateTime::<Utc>::from_timestamp_millis(start).ok_or_else(|| {
        AppError::new("TIME/INVALID_TIMESTAMP", "Invalid range start timestamp")
            .with_context("operation", "events_list_range")
            .with_context("household_id", household_id.to_string())
            .with_context("start", start.to_string())
    })?;
    let range_end_utc = DateTime::<Utc>::from_timestamp_millis(end).ok_or_else(|| {
        AppError::new("TIME/INVALID_TIMESTAMP", "Invalid range end timestamp")
            .with_context("operation", "events_list_range")
            .with_context("household_id", household_id.to_string())
            .with_context("end", end.to_string())
    })?;
    let row_count = rows.len();
    let mut truncated = false;
    let mut out = Vec::new();
    'rows: for (row_index, row) in rows.into_iter().enumerate() {
        shadow_audit.observe_event(
            &row.id,
            &row.household_id,
            row.tz.as_deref(),
            row.legacy_start_at,
            row.legacy_end_at,
            Some(row.start_at_utc),
            row.end_at_utc,
        );
        if let Some(rrule_str) = row.rrule.clone() {
            let event_id = row.id.clone();
            let tz_str = row.tz.clone().unwrap_or_else(|| "UTC".into());
            let tz_chrono: ChronoTz = tz_str.parse().map_err(|_| {
                TimeErrorCode::TimezoneUnknown
                    .into_error()
                    .with_context("operation", "events_list_range")
                    .with_context("household_id", household_id.to_string())
                    .with_context("event_id", event_id.clone())
                    .with_context("timezone", tz_str.clone())
            })?;
            let tz_name = tz_chrono.name().to_string();
            let tz: Tz = tz_chrono.into();
            let start_local = DateTime::<Utc>::from_timestamp_millis(row.start_at_utc)
                .ok_or_else(|| {
                    AppError::new(
                        "TIME/INVALID_TIMESTAMP",
                        "Invalid recurrence anchor timestamp",
                    )
                    .with_context("operation", "events_list_range")
                    .with_context("household_id", household_id.to_string())
                    .with_context("event_id", event_id.clone())
                    .with_context("field", "start_at_utc")
                })?
                .with_timezone(&tz);
            let duration_ms = row
                .end_at_utc
                .unwrap_or(row.start_at_utc)
                .saturating_sub(row.start_at_utc);
            let duration = Duration::milliseconds(duration_ms);

            // Parse RRULE → taxonomy error on failure
            let rrule_un: RRule<Unvalidated> = match rrule_str.parse() {
                Ok(un) => un,
                Err(err) => {
                    tracing::warn!(
                        target: "arklowdun",
                        event = "events_rrule_parse_error",
                        event_id = %event_id,
                        rule = %rrule_str.chars().take(80).collect::<String>(),
                        error = %err
                    );
                    return Err(TimeErrorCode::RruleUnsupportedField
                        .into_error()
                        .with_context("operation", "events_list_range")
                        .with_context("household_id", household_id.to_string())
                        .with_context("event_id", event_id.clone())
                        .with_context("rrule", rrule_str.clone())
                        .with_context("detail", err.to_string()));
                }
            };

            // Validate RRULE → taxonomy error on failure
            let rrule = match rrule_un.validate(start_local) {
                Ok(v) => v,
                Err(err) => {
                    tracing::warn!(
                        target: "arklowdun",
                        event = "events_rrule_validate_error",
                        event_id = %event_id,
                        rule = %rrule_str.chars().take(80).collect::<String>(),
                        error = %err
                    );
                    return Err(TimeErrorCode::RruleUnsupportedField
                        .into_error()
                        .with_context("operation", "events_list_range")
                        .with_context("household_id", household_id.to_string())
                        .with_context("event_id", event_id.clone())
                        .with_context("rrule", rrule_str.clone())
                        .with_context("detail", err.to_string()));
                }
            };

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

            let after = range_start_utc.with_timezone(&tz);
            let before = range_end_utc.with_timezone(&tz);
            set = set.after(after).before(before);

            let occurrences = set.all((PER_SERIES_LIMIT + 1) as u16);
            let mut dates = occurrences.dates;
            let series_over_limit = dates.len() > PER_SERIES_LIMIT;
            if series_over_limit {
                truncated = true;
                dates.truncate(PER_SERIES_LIMIT);
            }
            let series_len = dates.len();

            for (occ_index, occ) in dates.into_iter().enumerate() {
                if out.len() >= TOTAL_LIMIT {
                    truncated = true;
                    break 'rows;
                }
                let start_utc_ms = occ.with_timezone(&Utc).timestamp_millis();
                let end_dt = occ + duration;
                let end_utc_ms = end_dt.with_timezone(&Utc).timestamp_millis();
                if end_utc_ms < start || start_utc_ms > end {
                    continue;
                }
                let inst = Event {
                    id: format!("{}::{}", row.id, start_utc_ms),
                    household_id: row.household_id.clone(),
                    title: row.title.clone(),
                    tz: Some(tz_name.clone()),
                    start_at_utc: start_utc_ms,
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
                    if series_over_limit || occ_index + 1 < series_len || row_index + 1 < row_count
                    {
                        truncated = true;
                    }
                    break 'rows;
                }
            }
        } else {
            let start_utc = row.start_at_utc;
            let end_utc = row.end_at_utc.unwrap_or(row.start_at_utc);
            if end_utc >= start && start_utc <= end {
                if out.len() >= TOTAL_LIMIT {
                    truncated = true;
                    break;
                }
                out.push(Event::from(&row));
                if out.len() >= TOTAL_LIMIT {
                    if row_index + 1 < row_count {
                        truncated = true;
                    }
                    break;
                }
            }
        }
    }

    shadow_audit.finalize(pool).await;

    out.sort_by(|a, b| {
        a.start_at_utc
            .cmp(&b.start_at_utc)
            .then(a.title.cmp(&b.title))
            .then(a.id.cmp(&b.id))
    });

    Ok(EventsListRangeResponse {
        items: out,
        truncated,
    })
}
