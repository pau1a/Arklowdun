// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::{Arc, Mutex}};
use ts_rs::TS;
use tauri::{Manager, State};

use crate::state::AppState;

mod id;
mod time;
mod household; // declare module; avoid `use` to prevent name collision
mod state;
mod migrate;
mod repo;

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/bindings/Event.ts")]
pub struct Event {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub title: String,
    #[ts(type = "number")]
    pub datetime: i64,
    #[ts(type = "number | null")]
    pub reminder: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub created_at: i64,
    #[serde(default)]
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt", default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
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

#[tauri::command]
async fn delete_household_cmd(state: State<'_, AppState>, id: String) -> Result<Option<String>, String> {
    household::delete_household(&state.pool, &id)
        .await
        .map_err(|e| e.to_string())?;
    let current = { state.default_household_id.lock().unwrap().clone() };
    if current == id {
        let new_id = household::default_household_id(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
        {
            let mut guard = state.default_household_id.lock().unwrap();
            *guard = new_id.clone();
        }
        Ok(Some(new_id))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn restore_household_cmd(state: State<'_, AppState>, id: String) -> Result<(), String> {
    household::restore_household(&state.pool, &id)
        .await
        .map_err(|e| e.to_string())
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
            delete_household_cmd,
            restore_household_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
