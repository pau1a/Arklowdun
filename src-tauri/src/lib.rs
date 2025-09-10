// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use paste::paste;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use ts_rs::TS;

use crate::state::AppState;

mod attachments;
pub mod commands;
mod db;
mod events_tz_backfill;
mod household; // declare module; avoid `use` to prevent name collision
mod id;
mod importer;
mod migrate;
mod repo;
mod state;
mod time;

use commands::{map_db_error, DbErrorPayload};
use events_tz_backfill::events_backfill_timezone;
use tracing_subscriber::{fmt, EnvFilter};

pub fn init_logging() {
    let filter = std::env::var("TAURI_ARKLOWDUN_LOG")
        .unwrap_or_else(|_| "arklowdun=info,sqlx=warn".to_string());

    let _ = fmt()
        .with_env_filter(EnvFilter::new(filter))
        .json()
        .with_target(true)
        .with_timer(tracing_subscriber::fmt::time::UtcTime::rfc_3339())
        .with_current_span(false)
        .with_span_list(false)
        .try_init();
}

macro_rules! gen_domain_cmds {
    ( $( $table:ident ),+ $(,)? ) => {
        paste! {
            $(
                #[tauri::command]
                async fn [<$table _list>](
                    state: State<'_, AppState>,
                    household_id: String,
                    order_by: Option<String>,
                    limit: Option<i64>,
                    offset: Option<i64>,
                ) -> Result<Vec<serde_json::Value>, DbErrorPayload> {
                    commands::list_command(
                        &state.pool,
                        stringify!($table),
                        &household_id,
                        order_by.as_deref(),
                        limit,
                        offset,
                    ).await
                }

                #[tauri::command]
                async fn [<$table _get>](
                    state: State<'_, AppState>,
                    household_id: Option<String>,
                    id: String,
                ) -> Result<Option<serde_json::Value>, DbErrorPayload> {
                    let hh = household_id.as_deref();
                    commands::get_command(
                        &state.pool,
                        stringify!($table),
                        hh,
                        &id,
                    ).await
                }

                #[tauri::command]
                async fn [<$table _create>](
                    state: State<'_, AppState>,
                    data: serde_json::Map<String, serde_json::Value>,
                ) -> Result<serde_json::Value, DbErrorPayload> {
                    commands::create_command(
                        &state.pool,
                        stringify!($table),
                        data,
                    ).await
                }

                #[tauri::command]
                async fn [<$table _update>](
                    state: State<'_, AppState>,
                    id: String,
                    data: serde_json::Map<String, serde_json::Value>,
                    household_id: Option<String>,
                ) -> Result<(), DbErrorPayload> {
                    let hh = household_id.as_deref();
                    commands::update_command(
                        &state.pool,
                        stringify!($table),
                        &id,
                        data,
                        hh,
                    ).await
                }

                #[tauri::command]
                async fn [<$table _delete>](
                    state: State<'_, AppState>,
                    household_id: String,
                    id: String,
                ) -> Result<(), DbErrorPayload> {
                    commands::delete_command(
                        &state.pool,
                        stringify!($table),
                        &household_id,
                        &id,
                    ).await
                }

                #[tauri::command]
                async fn [<$table _restore>](
                    state: State<'_, AppState>,
                    household_id: String,
                    id: String,
                ) -> Result<(), DbErrorPayload> {
                    commands::restore_command(
                        &state.pool,
                        stringify!($table),
                        &household_id,
                        &id,
                    ).await
                }
            )+
        }
    };
}

gen_domain_cmds!(
    household,
    bills,
    policies,
    property_documents,
    inventory_items,
    // vehicles is handled below (typed list + explicit CRUD wrappers)
    vehicle_maintenance,
    pets,
    pet_medical,
    family_members,
    budget_categories,
    expenses,
    notes,
    shopping_items,
);

#[derive(Serialize, Deserialize, Clone, TS, sqlx::FromRow)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Vehicle {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub make: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub vin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub next_mot_due: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub next_service_due: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub created_at: i64,
    #[serde(default)]
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deleted_at: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub position: i64,
}

// Typed list for Dashboard (rich fields)
#[tauri::command]
async fn vehicles_list(
    state: State<'_, AppState>,
    household_id: String,
) -> Result<Vec<Vehicle>, DbErrorPayload> {
    sqlx::query_as::<_, Vehicle>(
        "SELECT id, household_id, name, make, model, reg, vin,\n         COALESCE(next_mot_due, mot_date)         AS next_mot_due,\n         COALESCE(next_service_due, service_date) AS next_service_due,\n         created_at, updated_at, deleted_at, position\n    FROM vehicles\n   WHERE household_id = ? AND deleted_at IS NULL\n   ORDER BY position, created_at, id",
    )
    .bind(household_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| DbErrorPayload {
        code: "Unknown".into(),
        message: e.to_string(),
    })
}

// Generic CRUD wrappers so legacy UI continues to work
#[tauri::command]
async fn vehicles_get(
    state: State<'_, AppState>,
    household_id: Option<String>,
    id: String,
) -> Result<Option<serde_json::Value>, DbErrorPayload> {
    commands::get_command(&state.pool, "vehicles", household_id.as_deref(), &id).await
}

#[tauri::command]
async fn vehicles_create(
    state: State<'_, AppState>,
    data: serde_json::Map<String, serde_json::Value>,
) -> Result<serde_json::Value, DbErrorPayload> {
    commands::create_command(&state.pool, "vehicles", data).await
}

#[tauri::command]
async fn vehicles_update(
    state: State<'_, AppState>,
    id: String,
    data: serde_json::Map<String, serde_json::Value>,
    household_id: Option<String>,
) -> Result<(), DbErrorPayload> {
    commands::update_command(&state.pool, "vehicles", &id, data, household_id.as_deref()).await
}

#[tauri::command]
async fn vehicles_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> Result<(), DbErrorPayload> {
    commands::delete_command(&state.pool, "vehicles", &household_id, &id).await
}

#[tauri::command]
async fn vehicles_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> Result<(), DbErrorPayload> {
    commands::restore_command(&state.pool, "vehicles", &household_id, &id).await
}

#[derive(Serialize, Deserialize, Clone, TS, sqlx::FromRow)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Event {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub title: String,
    #[ts(type = "number")]
    pub start_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub end_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tz: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub start_at_utc: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub end_at_utc: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[sqlx(default)]
    pub rrule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[sqlx(default)]
    pub exdates: Option<String>,
    #[ts(optional, type = "number")]
    pub reminder: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub created_at: i64,
    #[serde(default)]
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deleted_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[sqlx(default)]
    pub series_parent_id: Option<String>,
}

#[tauri::command]
async fn events_list_range(
    state: State<'_, AppState>,
    household_id: String,
    start: i64,
    end: i64,
) -> Result<Vec<Event>, DbErrorPayload> {
    commands::events_list_range_command(&state.pool, &household_id, start, end).await
}

#[tauri::command]
async fn event_create(
    state: State<'_, AppState>,
    data: serde_json::Map<String, serde_json::Value>,
) -> Result<serde_json::Value, DbErrorPayload> {
    commands::create_command(&state.pool, "events", data).await
}

#[tauri::command]
async fn event_update(
    state: State<'_, AppState>,
    id: String,
    data: serde_json::Map<String, serde_json::Value>,
    household_id: String,
) -> Result<(), DbErrorPayload> {
    commands::update_command(&state.pool, "events", &id, data, Some(&household_id)).await
}

#[tauri::command]
async fn event_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> Result<(), DbErrorPayload> {
    commands::delete_command(&state.pool, "events", &household_id, &id).await
}

#[tauri::command]
async fn event_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> Result<(), DbErrorPayload> {
    commands::restore_command(&state.pool, "events", &household_id, &id).await
}

#[tauri::command]
async fn bills_list_due_between(
    state: State<'_, AppState>,
    household_id: String,
    from_ms: i64,
    to_ms: i64,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<serde_json::Value>, DbErrorPayload> {
    use sqlx::query;

    let base_sql = r#"
        SELECT * FROM bills
        WHERE household_id = ?1
          AND deleted_at IS NULL
          AND due_date >= ?2
          AND due_date <= ?3
        ORDER BY due_date ASC, created_at ASC, id ASC
    "#;

    let mut sql = base_sql.to_string();
    let has_limit = limit.unwrap_or(0) > 0;
    let has_offset = offset.unwrap_or(0) > 0;
    if has_limit {
        sql.push_str(" LIMIT ?4");
    }
    if has_offset {
        sql.push_str(" OFFSET ?5");
    }

    let mut q = query(&sql).bind(&household_id).bind(from_ms).bind(to_ms);

    if has_limit {
        q = q.bind(limit.unwrap());
    }
    if has_offset {
        q = q.bind(offset.unwrap());
    }

    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(crate::commands::map_db_error)?;

    Ok(rows.into_iter().map(crate::repo::row_to_json).collect())
}

#[tauri::command]
fn get_default_household_id(state: tauri::State<state::AppState>) -> String {
    state.default_household_id.lock().unwrap().clone()
}

#[tauri::command]
fn set_default_household_id(state: tauri::State<state::AppState>, id: String) {
    *state.default_household_id.lock().unwrap() = id;
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportArgs {
    #[serde(alias = "household_id")]
    household_id: String,
    #[serde(alias = "dry_run")]
    dry_run: bool,
}

#[tauri::command]
async fn import_run_legacy(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    args: ImportArgs,
) -> Result<(), DbErrorPayload> {
    let household_id = args.household_id;
    let dry_run = args.dry_run;
    importer::run_import(&app, household_id, dry_run)
        .await
        .map_err(map_db_error)
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(tag = "kind")]
pub enum SearchResult {
    File {
        id: String,
        filename: String,
        #[ts(type = "number")]
        updated_at: i64,
    },
    Event {
        id: String,
        title: String,
        #[ts(type = "number")]
        start_at_utc: i64,
        tz: String,
    },
    Note {
        id: String,
        snippet: String,
        #[ts(type = "number")]
        updated_at: i64,
        color: String,
    },
    Vehicle {
        id: String,
        make: String,
        model: String,
        reg: String,
        #[ts(type = "number")]
        updated_at: i64,
        nickname: String,
    },
    Pet {
        id: String,
        name: String,
        species: String,
        #[ts(type = "number")]
        updated_at: i64,
    },
}

#[derive(Serialize, Deserialize)]
pub struct SearchErrorPayload {
    pub code: String,
    pub message: String,
    pub details: serde_json::Value,
}

async fn table_exists(pool: &sqlx::SqlitePool, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?1",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap_or(0)
        > 0
}

#[tauri::command]
async fn db_table_exists(state: State<'_, AppState>, name: String) -> bool {
    table_exists(&state.pool, &name).await
}

#[tauri::command]
async fn db_has_files_index(state: State<'_, AppState>) -> bool {
    table_exists(&state.pool, "files_index").await
}

#[tauri::command]
async fn db_has_vehicle_columns(state: State<'_, AppState>) -> bool {
    let pool = &state.pool;
    if !table_exists(pool, "vehicles").await {
        return false;
    }
    let cols = table_columns(pool, "vehicles").await;
    cols.contains("reg")
        || cols.contains("registration")
        || cols.contains("plate")
        || cols.contains("nickname")
        || cols.contains("name")
}

#[tauri::command]
async fn db_has_pet_columns(state: State<'_, AppState>) -> bool {
    let pool = &state.pool;
    if !table_exists(pool, "pets").await {
        return false;
    }
    let cols = table_columns(pool, "pets").await;
    cols.contains("name") || cols.contains("species") || cols.contains("type")
}

/// Return the set of column names for a given table.
async fn table_columns(pool: &sqlx::SqlitePool, table: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    // NOTE: using a literal table name; NOT user-provided.
    // PRAGMA returns an error when the table is missing or the DB is malformed; that's expected.
    // In those cases we swallow the error and return an empty set silently.
    let sql = format!("PRAGMA table_info({})", table);
    if let Ok(rows) = sqlx::query(&sql).fetch_all(pool).await {
        for r in rows {
            if let Ok(name) = r.try_get::<String, _>("name") {
                out.insert(name);
            }
        }
    }
    out
}

/// Build a COALESCE(expr...) using only the columns that actually exist.
/// If none of the candidates exist, returns the provided default literal.
/// `default_literal` should already be a valid SQL literal (e.g. '' or 0).
fn coalesce_expr(
    existing: &std::collections::HashSet<String>,
    candidates: &[&str],
    default_literal: &str,
) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for c in candidates {
        if existing.contains(*c) {
            parts.push(c);
        }
    }
    if parts.is_empty() {
        default_literal.to_string()
    } else if parts.len() == 1 {
        parts[0].to_string()
    } else {
        format!("COALESCE({})", parts.join(", "))
    }
}

#[tauri::command]
async fn search_entities(
    state: State<'_, AppState>,
    household_id: String,
    query: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<SearchResult>, SearchErrorPayload> {
    use sqlx::Row;
    let pool = &state.pool;

    if household_id.trim().is_empty() {
        return Err(SearchErrorPayload {
            code: "BAD_REQUEST".into(),
            message: "household_id is required".into(),
            details: serde_json::json!({}),
        });
    }
    if !(1..=100).contains(&limit) || offset < 0 {
        return Err(SearchErrorPayload {
            code: "BAD_REQUEST".into(),
            message: "invalid limit/offset".into(),
            details: serde_json::json!({ "limit": limit, "offset": offset }),
        });
    }

    let q = query.trim().to_string();
    tracing::debug!(target: "arklowdun", household_id = %household_id, q = %q, limit, offset, "search_invoke");
    if q.is_empty() {
        return Ok(vec![]);
    }
    let prefix = format!("{}%", q);
    let sub = format!("%{}%", q);

    let has_files_index = table_exists(pool, "files_index").await;
    let has_files_table = table_exists(pool, "files").await;

    let has_events = table_exists(pool, "events").await;
    if !has_events {
        tracing::debug!(target: "arklowdun", name = "events", "missing_table");
    }
    let has_notes = table_exists(pool, "notes").await;
    if !has_notes {
        tracing::debug!(target: "arklowdun", name = "notes", "missing_table");
    }
    let has_vehicles = table_exists(pool, "vehicles").await;
    if !has_vehicles {
        tracing::debug!(target: "arklowdun", name = "vehicles", "missing_table");
    }
    let has_pets = table_exists(pool, "pets").await;
    if !has_pets {
        tracing::debug!(target: "arklowdun", name = "pets", "missing_table");
    }

    let short = q.len() < 2;
    if short && !(has_files_index || has_files_table) {
        tracing::debug!(target: "arklowdun", q = %q, len = q.len(), "short_query_bypass");
        return Ok(vec![]);
    }

    let mapq = |e: sqlx::Error| SearchErrorPayload {
        code: "DB/QUERY_FAILED".into(),
        message: "Search failed".into(),
        details: serde_json::json!({ "error": e.to_string() }),
    };

    let mut out: Vec<(i32, i64, usize, SearchResult)> = Vec::new();
    let mut ord: usize = 0;

    if has_files_index || has_files_table {
        let (sql, branch_name) = if has_files_index {
            (
                "SELECT id, filename, updated_at AS ts FROM files_index\n             WHERE household_id=?1 AND filename LIKE ?2 COLLATE NOCASE\n             ORDER BY filename ASC LIMIT ?3 OFFSET ?4",
                "files_index",
            )
        } else {
            (
                "SELECT id, filename, updated_at AS ts FROM files\n             WHERE household_id=?1 AND filename LIKE ?2 COLLATE NOCASE\n             ORDER BY filename ASC LIMIT ?3 OFFSET ?4",
                "files",
            )
        };
        let start = std::time::Instant::now();
        let rows = sqlx::query(sql)
            .bind(&household_id)
            .bind(&prefix)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(mapq)?;
        let elapsed = start.elapsed().as_millis() as i64;
        tracing::debug!(target: "arklowdun", name = branch_name, rows = rows.len(), elapsed_ms = elapsed, "branch");
        for r in rows {
            let filename: String = r.try_get("filename").unwrap_or_default();
            let ts: i64 = r.try_get("ts").unwrap_or_default();
            let score = if filename.eq_ignore_ascii_case(&q) {
                2
            } else {
                1
            };
            let id: String = r.try_get("id").unwrap_or_default();
            out.push((
                score,
                ts,
                ord,
                SearchResult::File {
                    id,
                    filename,
                    updated_at: ts,
                },
            ));
            ord += 1;
        }
    }

    if !short {
        if has_events {
            let start = std::time::Instant::now();
            let events = sqlx::query(
                "SELECT id, title, start_at_utc AS ts, COALESCE(tz,'Europe/London') AS tz\n         FROM events\n         WHERE household_id=?1 AND title LIKE ?2 COLLATE NOCASE\n         ORDER BY title ASC LIMIT ?3 OFFSET ?4",
            )
            .bind(&household_id)
            .bind(&sub)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(mapq)?;
            let elapsed = start.elapsed().as_millis() as i64;
            tracing::debug!(target: "arklowdun", name = "events", rows = events.len(), elapsed_ms = elapsed, "branch");
            for r in events {
                let title: String = r.try_get("title").unwrap_or_default();
                let ts: i64 = r.try_get("ts").unwrap_or_default();
                let tz: String = r
                    .try_get("tz")
                    .unwrap_or_else(|_| "Europe/London".to_string());
                let score = if title.eq_ignore_ascii_case(&q) { 2 } else { 1 };
                let id: String = r.try_get("id").unwrap_or_default();
                out.push((
                    score,
                    ts,
                    ord,
                    SearchResult::Event {
                        id,
                        title,
                        start_at_utc: ts,
                        tz,
                    },
                ));
                ord += 1;
            }
        }

        if has_notes {
            let start = std::time::Instant::now();
            let notes = sqlx::query(
                "SELECT id, text, updated_at AS ts, COALESCE(color,'') AS color\n         FROM notes\n         WHERE household_id=?1 AND text LIKE ?2 COLLATE NOCASE\n         ORDER BY ts DESC LIMIT ?3 OFFSET ?4",
            )
            .bind(&household_id)
            .bind(&sub)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(mapq)?;
            let elapsed = start.elapsed().as_millis() as i64;
            tracing::debug!(target: "arklowdun", name = "notes", rows = notes.len(), elapsed_ms = elapsed, "branch");
            for r in notes {
                let text: String = r.try_get("text").unwrap_or_default();
                let ts: i64 = r.try_get("ts").unwrap_or_default();
                let color: String = r.try_get("color").unwrap_or_default();
                let score = if text.eq_ignore_ascii_case(&q) { 2 } else { 1 };
                let snippet: String = text.chars().take(80).collect();
                let id: String = r.try_get("id").unwrap_or_default();
                out.push((
                    score,
                    ts,
                    ord,
                    SearchResult::Note {
                        id,
                        snippet,
                        updated_at: ts,
                        color,
                    },
                ));
                ord += 1;
            }
        }

        if has_vehicles {
            let start = std::time::Instant::now();
            // Discover available columns to avoid "no such column" at parse time.
            let vcols = table_columns(pool, "vehicles").await;
            let reg_expr = coalesce_expr(&vcols, &["reg", "registration", "plate"], "''");
            let nick_expr = coalesce_expr(&vcols, &["nickname", "name"], "''");
            let ts_expr = coalesce_expr(&vcols, &["updated_at", "created_at"], "0");

            let make_expr = if vcols.contains("make") {
                "COALESCE(make,'')"
            } else {
                "''"
            };
            let model_expr = if vcols.contains("model") {
                "COALESCE(model,'')"
            } else {
                "''"
            };

            let sql = format!(
                "SELECT id, {make_expr} AS make, {model_expr} AS model, {reg_expr} AS reg, {nick_expr} AS nickname, {ts_expr} AS ts \
                 FROM vehicles \
                 WHERE household_id=?1 AND ( \
                     {make_expr} LIKE ?2 COLLATE NOCASE OR \
                     {model_expr} LIKE ?2 COLLATE NOCASE OR \
                     {reg_expr}   LIKE ?2 COLLATE NOCASE OR \
                     {nick_expr}  LIKE ?2 COLLATE NOCASE \
                 ) \
                 ORDER BY ts DESC LIMIT ?3 OFFSET ?4",
                make_expr = make_expr,
                model_expr = model_expr,
                reg_expr = reg_expr,
                nick_expr = nick_expr,
                ts_expr = ts_expr,
            );

            let rows = sqlx::query(&sql)
                .bind(&household_id)
                .bind(&sub)
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await
                .map_err(mapq)?;
            let elapsed = start.elapsed().as_millis() as i64;
            tracing::debug!(target: "arklowdun", name = "vehicles", rows = rows.len(), elapsed_ms = elapsed, "branch");
            for r in rows {
                let make: String = r.try_get("make").unwrap_or_default();
                let model: String = r.try_get("model").unwrap_or_default();
                let reg: String = r.try_get("reg").unwrap_or_default();
                let nickname: String = r.try_get("nickname").unwrap_or_default();
                let ts: i64 = r.try_get("ts").unwrap_or_default();
                let exact = |s: &str| !s.is_empty() && s.eq_ignore_ascii_case(&q);
                let score = if exact(&make) || exact(&model) || exact(&reg) || exact(&nickname) {
                    2
                } else {
                    1
                };
                let id: String = r.try_get("id").unwrap_or_default();
                out.push((
                    score,
                    ts,
                    ord,
                    SearchResult::Vehicle {
                        id,
                        make,
                        model,
                        reg,
                        updated_at: ts,
                        nickname,
                    },
                ));
                ord += 1;
            }
        }

        if has_pets {
            let start = std::time::Instant::now();
            let pcols = table_columns(pool, "pets").await;
            let name_expr = if pcols.contains("name") {
                "COALESCE(name,'')"
            } else {
                "''"
            };
            let species_expr = coalesce_expr(&pcols, &["species", "type"], "''");
            let ts_expr = coalesce_expr(&pcols, &["updated_at", "created_at"], "0");

            let sql = format!(
                "SELECT id, {name_expr} AS name, {species_expr} AS species, {ts_expr} AS ts \
                 FROM pets \
                 WHERE household_id=?1 AND ( \
                     {name_expr}   LIKE ?2 COLLATE NOCASE OR \
                     {species_expr} LIKE ?2 COLLATE NOCASE \
                 ) \
                 ORDER BY ts DESC LIMIT ?3 OFFSET ?4",
                name_expr = name_expr,
                species_expr = species_expr,
                ts_expr = ts_expr,
            );

            let rows = sqlx::query(&sql)
                .bind(&household_id)
                .bind(&sub)
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await
                .map_err(mapq)?;
            let elapsed = start.elapsed().as_millis() as i64;
            tracing::debug!(target: "arklowdun", name = "pets", rows = rows.len(), elapsed_ms = elapsed, "branch");
            for r in rows {
                let name: String = r.try_get("name").unwrap_or_default();
                let species: String = r.try_get("species").unwrap_or_default();
                let ts: i64 = r.try_get("ts").unwrap_or_default();
                let score = if name.eq_ignore_ascii_case(&q) || species.eq_ignore_ascii_case(&q) {
                    2
                } else {
                    1
                };
                let id: String = r.try_get("id").unwrap_or_default();
                out.push((
                    score,
                    ts,
                    ord,
                    SearchResult::Pet {
                        id,
                        name,
                        species,
                        updated_at: ts,
                    },
                ));
                ord += 1;
            }
        }
    }

    out.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    let total_before = out.len();
    if out.len() > 100 {
        out.truncate(100);
    }
    tracing::debug!(target: "arklowdun", total_before, returned = out.len(), "result_summary");

    Ok(out.into_iter().map(|(_, _, _, v)| v).collect())
}

#[tauri::command]
async fn attachment_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    table: String,
    id: String,
) -> Result<(), crate::commands::DbErrorPayload> {
    let (root_key, rel) = attachments::load_attachment_columns(&state.pool, &table, &id).await?;
    let path = attachments::resolve_attachment_path(&app, &root_key, &rel)?;
    attachments::open_with_os(&path)
}

#[tauri::command]
async fn attachment_reveal(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    table: String,
    id: String,
) -> Result<(), crate::commands::DbErrorPayload> {
    let (root_key, rel) = attachments::load_attachment_columns(&state.pool, &table, &id).await?;
    let path = attachments::resolve_attachment_path(&app, &root_key, &rel)?;
    attachments::reveal_with_os(&path)
}

#[tauri::command]
async fn open_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), crate::commands::DbErrorPayload> {
    use std::path::Path;
    let _ = app;
    crate::attachments::open_with_os(Path::new(&path))
}

macro_rules! app_commands {
    ($($extra:ident),* $(,)?) => {
        tauri::generate_handler![
            events_backfill_timezone,
            events_list_range,
            event_create,
            event_update,
            event_delete,
            event_restore,
            get_default_household_id,
            household_list,
            household_get,
            household_create,
            household_update,
            household_delete,
            household_restore,
            bills_list,
            bills_get,
            bills_create,
            bills_update,
            bills_delete,
            bills_restore,
            bills_list_due_between,
            policies_list,
            policies_get,
            policies_create,
            policies_update,
            policies_delete,
            policies_restore,
            property_documents_list,
            property_documents_get,
            property_documents_create,
            property_documents_update,
            property_documents_delete,
            property_documents_restore,
            inventory_items_list,
            inventory_items_get,
            inventory_items_create,
            inventory_items_update,
            inventory_items_delete,
            inventory_items_restore,
            vehicles_list,
            vehicles_get,
            vehicles_create,
            vehicles_update,
            vehicles_delete,
            vehicles_restore,
            vehicle_maintenance_list,
            vehicle_maintenance_get,
            vehicle_maintenance_create,
            vehicle_maintenance_update,
            vehicle_maintenance_delete,
            vehicle_maintenance_restore,
            pets_list,
            pets_get,
            pets_create,
            pets_update,
            pets_delete,
            pets_restore,
            pet_medical_list,
            pet_medical_get,
            pet_medical_create,
            pet_medical_update,
            pet_medical_delete,
            pet_medical_restore,
            family_members_list,
            family_members_get,
            family_members_create,
            family_members_update,
            family_members_delete,
            family_members_restore,
            budget_categories_list,
            budget_categories_get,
            budget_categories_create,
            budget_categories_update,
            budget_categories_delete,
            budget_categories_restore,
            expenses_list,
            expenses_get,
            expenses_create,
            expenses_update,
            expenses_delete,
            expenses_restore,
            notes_list,
            notes_get,
            notes_create,
            notes_update,
            notes_delete,
            notes_restore,
            shopping_items_list,
            shopping_items_get,
            shopping_items_create,
            shopping_items_update,
            shopping_items_delete,
            shopping_items_restore,
            attachment_open,
            attachment_reveal,
            $($extra),*
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let handle = app.handle();
            #[allow(clippy::needless_borrow)]
            let pool = tauri::async_runtime::block_on(crate::db::open_sqlite_pool(&handle))?;
            tauri::async_runtime::block_on(crate::migrate::apply_migrations(&pool))?;
            tauri::async_runtime::block_on(async {
                if let Ok(cols) = sqlx::query("PRAGMA table_info(events);").fetch_all(&pool).await {
                    let names: Vec<String> = cols
                        .into_iter()
                        .filter_map(|r| r.try_get::<String, _>("name").ok())
                        .collect();
                    let has_start = names.iter().any(|n| n == "start_at");
                    let has_end = names.iter().any(|n| n == "end_at");
                    tracing::info!(target="arklowdun", event="events_table_columns", has_start_at=%has_start, has_end_at=%has_end);
                }
            });
            let hh = tauri::async_runtime::block_on(crate::household::default_household_id(&pool))?;
            app.manage(crate::state::AppState {
                pool: pool.clone(),
                default_household_id: Arc::new(Mutex::new(hh)),
            });
            Ok(())
        })
        .invoke_handler(app_commands![
            search_entities,
            import_run_legacy,
            open_path,
            set_default_household_id,
            db_table_exists,
            db_has_files_index,
            db_has_vehicle_columns,
            db_has_pet_columns
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, feature = "legacy_deleted_at"))]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_accepts_legacy_deleted_at() {
        let payload = json!({
            "id": "e1",
            "household_id": "h1",
            "title": "T",
            "start_at": 1,
            "end_at": 2,
            "deletedAt": 999
        });
        let ev: Event = serde_json::from_value(payload).unwrap();
        assert_eq!(ev.deleted_at, Some(999));
    }
}
