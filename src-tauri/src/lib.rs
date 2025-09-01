// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_sql;

mod id;

#[derive(Serialize, Deserialize, Clone)]
struct Event {
    #[serde(default)]
    id: String,
    title: String,
    datetime: String,
    reminder: Option<i64>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawEvent {
    New(Event),
    Old {
        _id: u32,
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
                RawEvent::New(ev) => converted.push(ev),
                RawEvent::Old { title, datetime, reminder, .. } => {
                    changed = true;
                    converted.push(Event {
                        id: crate::id::new_uuid_v7(),
                        title,
                        datetime,
                        reminder,
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
    events.push(event.clone());
    write_events(&app, &events)?;
    Ok(event)
}

#[tauri::command]
fn update_event(app: tauri::AppHandle, event: Event) -> Result<(), String> {
    let mut events = read_events(&app);
    if let Some(e) = events.iter_mut().find(|e| e.id == event.id) {
        *e = event;
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
