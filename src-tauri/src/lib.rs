// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::{Arc, Mutex}};
use ts_rs::TS;
use tauri::{Manager, State};
use paste::paste;

use crate::state::AppState;

mod id;
mod time;
mod household; // declare module; avoid `use` to prevent name collision
mod state;
mod migrate;
mod repo;
mod commands;

use commands::DbErrorPayload;

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
    events,
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

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Event {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub title: String,
    #[ts(type = "number")]
    pub datetime: i64,
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

#[derive(Deserialize)]
#[serde(untagged)]
enum RawEvent {
    New(Event),
    OldNumericId {
        #[serde(rename = "id")]
        _id: u32,
        title: String,
        datetime: String,
        reminder: Option<i64>,
    },
    OldStringId {
        id: String,
        title: String,
        datetime: String,
        reminder: Option<i64>,
    },
}

fn events_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("events.json")
}

fn read_events(app: &tauri::AppHandle, state: &tauri::State<state::AppState>) -> Vec<Event> {
    let path = events_path(app);
    let default_hh = state.default_household_id.lock().unwrap().clone();
    if let Ok(data) = fs::read_to_string(&path) {
        let raw: Vec<RawEvent> = serde_json::from_str(&data).unwrap_or_default();
        let mut converted = Vec::new();
        let mut changed = false;
        for r in raw {
            match r {
                RawEvent::New(mut ev) => {
                    if ev.created_at == 0 { ev.created_at = time::now_ms(); changed = true; }
                    if ev.updated_at == 0 { ev.updated_at = ev.created_at; changed = true; }
                    if ev.household_id.is_empty() { ev.household_id = default_hh.clone(); changed = true; }
                    converted.push(ev);
                }
                RawEvent::OldNumericId { title, datetime, reminder, .. } => {
                    changed = true;
                    let dt = chrono::DateTime::parse_from_rfc3339(&datetime)
                        .map(|d| d.timestamp_millis())
                        .unwrap_or_else(|_| time::now_ms());
                    converted.push(Event {
                        id: crate::id::new_uuid_v7(),
                        household_id: default_hh.clone(),
                        title,
                        datetime: dt,
                        reminder,
                        created_at: time::now_ms(),
                        updated_at: time::now_ms(),
                        deleted_at: None,
                    });
                }
                RawEvent::OldStringId { id, title, datetime, reminder } => {
                    changed = true;
                    let dt = chrono::DateTime::parse_from_rfc3339(&datetime)
                        .map(|d| d.timestamp_millis())
                        .unwrap_or_else(|_| time::now_ms());
                    converted.push(Event {
                        id,
                        household_id: default_hh.clone(),
                        title,
                        datetime: dt,
                        reminder,
                        created_at: time::now_ms(),
                        updated_at: time::now_ms(),
                        deleted_at: None,
                    });
                }
            }
        }
        if changed {
            let _ = write_events(app, &converted);
        }
        converted
    } else {
        Vec::new()
    }
}

fn write_events(app: &tauri::AppHandle, events: &Vec<Event>) -> Result<(), String> {
    let path = events_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string(events).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_events(app: tauri::AppHandle, state: tauri::State<state::AppState>) -> Result<Vec<Event>, String> {
    let events = read_events(&app, &state);
    Ok(events.into_iter().filter(|e| e.deleted_at.is_none()).collect())
}

#[tauri::command]
fn add_event(app: tauri::AppHandle, state: tauri::State<state::AppState>, mut event: Event) -> Result<Event, String> {
    let mut events = read_events(&app, &state);
    event.id = crate::id::new_uuid_v7();
    let now = time::now_ms();
    event.created_at = now;
    event.updated_at = now;
    event.deleted_at = None;
    if event.household_id.is_empty() {
        event.household_id = state.default_household_id.lock().unwrap().clone();
    }
    events.push(event.clone());
    write_events(&app, &events)?;
    Ok(event)
}

#[tauri::command]
fn update_event(app: tauri::AppHandle, state: tauri::State<state::AppState>, event: Event) -> Result<(), String> {
    let mut events = read_events(&app, &state);
    if let Some(e) = events.iter_mut().find(|e| e.id == event.id && e.deleted_at.is_none()) {
        let mut new_event = event;
        new_event.created_at = e.created_at;
        new_event.updated_at = time::now_ms();
        new_event.household_id = e.household_id.clone();
        new_event.deleted_at = e.deleted_at;
        *e = new_event;
        write_events(&app, &events)
    } else {
        Err("Event not found".into())
    }
}

#[tauri::command]
fn delete_event(app: tauri::AppHandle, state: tauri::State<state::AppState>, id: String) -> Result<(), String> {
    let mut events = read_events(&app, &state);
    if let Some(e) = events.iter_mut().find(|e| e.id == id && e.deleted_at.is_none()) {
        e.deleted_at = Some(time::now_ms());
        write_events(&app, &events)
    } else {
        Err("Event not found".into())
    }
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
            let pool = tauri::async_runtime::block_on(crate::migrate::init_db(handle))?;
            let hh = tauri::async_runtime::block_on(crate::household::default_household_id(&pool))?;
            app.manage(crate::state::AppState { pool: pool.clone(), default_household_id: Arc::new(Mutex::new(hh)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_events,
            add_event,
            update_event,
            delete_event,
            get_default_household_id,
            household_list,
            household_get,
            household_create,
            household_update,
            household_delete,
            household_restore,
            events_list,
            events_get,
            events_create,
            events_update,
            events_delete,
            events_restore,
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
            "datetime": 1,
            "deletedAt": 999
        });
        let ev: Event = serde_json::from_value(payload).unwrap();
        assert_eq!(ev.deleted_at, Some(999));
    }
}
