// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_sql;

mod id;
mod time;

#[derive(Serialize, Deserialize, Clone)]
struct Event {
    #[serde(default)]
    id: String,
    title: String,
    datetime: i64,
    reminder: Option<i64>,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
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

fn read_events(app: &tauri::AppHandle) -> Vec<Event> {
    let path = events_path(app);
    if let Ok(data) = fs::read_to_string(&path) {
        let raw: Vec<RawEvent> = serde_json::from_str(&data).unwrap_or_default();
        let mut converted = Vec::new();
        let mut changed = false;
        for r in raw {
            match r {
                RawEvent::New(mut ev) => {
                    if ev.created_at == 0 { ev.created_at = time::now_ms(); changed = true; }
                    if ev.updated_at == 0 { ev.updated_at = ev.created_at; changed = true; }
                    converted.push(ev);
                }
                RawEvent::OldNumericId { title, datetime, reminder, .. } => {
                    changed = true;
                    let dt = chrono::DateTime::parse_from_rfc3339(&datetime)
                        .map(|d| d.timestamp_millis())
                        .unwrap_or_else(|_| time::now_ms());
                    converted.push(Event {
                        id: crate::id::new_uuid_v7(),
                        title,
                        datetime: dt,
                        reminder,
                        created_at: time::now_ms(),
                        updated_at: time::now_ms(),
                    });
                }
                RawEvent::OldStringId { id, title, datetime, reminder } => {
                    changed = true;
                    let dt = chrono::DateTime::parse_from_rfc3339(&datetime)
                        .map(|d| d.timestamp_millis())
                        .unwrap_or_else(|_| time::now_ms());
                    converted.push(Event {
                        id,
                        title,
                        datetime: dt,
                        reminder,
                        created_at: time::now_ms(),
                        updated_at: time::now_ms(),
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
fn get_events(app: tauri::AppHandle) -> Result<Vec<Event>, String> {
    Ok(read_events(&app))
}

#[tauri::command]
fn add_event(app: tauri::AppHandle, mut event: Event) -> Result<Event, String> {
    let mut events = read_events(&app);
    event.id = crate::id::new_uuid_v7();
    let now = time::now_ms();
    event.created_at = now;
    event.updated_at = now;
    events.push(event.clone());
    write_events(&app, &events)?;
    Ok(event)
}

#[tauri::command]
fn update_event(app: tauri::AppHandle, event: Event) -> Result<(), String> {
    let mut events = read_events(&app);
    if let Some(e) = events.iter_mut().find(|e| e.id == event.id) {
        let mut new_event = event;
        new_event.created_at = e.created_at;
        new_event.updated_at = time::now_ms();
        *e = new_event;
        write_events(&app, &events)
    } else {
        Err("Event not found".into())
    }
}

#[tauri::command]
fn delete_event(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut events = read_events(&app);
    let len_before = events.len();
    events.retain(|e| e.id != id);
    if events.len() == len_before {
        return Err("Event not found".into());
    }
    write_events(&app, &events)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_events,
            add_event,
            update_event,
            delete_event
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
