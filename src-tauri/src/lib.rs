// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use paste::paste;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use ts_rs::TS;

use crate::state::AppState;

pub mod commands;
mod db;
mod events_tz_backfill;
mod household; // declare module; avoid `use` to prevent name collision
mod id;
mod migrate;
mod repo;
mod state;
mod time;
mod importer;
mod attachments;

use commands::{DbErrorPayload, map_db_error};
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
async fn import_run_legacy(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    household_id: String,
    dry_run: bool,
) -> Result<(), DbErrorPayload> {
    importer::run_import(&app, household_id, dry_run)
        .await
        .map_err(map_db_error)
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
    let import_enabled = std::env::var("TAURI_FEATURES_IMPORT").ok().as_deref() == Some("1");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        });

    let builder = if import_enabled {
        builder.invoke_handler(app_commands![import_run_legacy])
    } else {
        builder.invoke_handler(app_commands![])
    };

    builder
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
