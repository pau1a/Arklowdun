// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use paste::paste;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use ts_rs::TS;
use sqlx::Row;

use crate::state::AppState;

mod commands;
mod db;
mod household; // declare module; avoid `use` to prevent name collision
mod id;
mod migrate;
mod repo;
mod state;
mod time;
mod events_tz_backfill;

use commands::DbErrorPayload;
use events_tz_backfill::events_backfill_timezone;
use tracing_subscriber::{prelude::*, EnvFilter};

pub fn init_logging() {
    let fmt_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_target(true)
        .with_timer(tracing_subscriber::fmt::time::UtcTime::rfc_3339());

    let filter = EnvFilter::new("arklowdun=info,sqlx=warn");

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
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
    vehicles,
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
fn get_default_household_id(state: tauri::State<state::AppState>) -> String {
    state.default_household_id.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        })
        .invoke_handler(tauri::generate_handler![
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
            shopping_items_restore
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
