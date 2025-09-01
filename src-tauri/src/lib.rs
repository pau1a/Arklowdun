// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_sql;

#[derive(Serialize, Deserialize, Clone)]
struct Event {
    id: u32,
    title: String,
    datetime: String,
    reminder: Option<i64>,
}

fn events_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("events.json")
}

fn read_events(app: &tauri::AppHandle) -> Vec<Event> {
    let path = events_path(app);
    if let Ok(data) = fs::read_to_string(path) {
        serde_json::from_str(&data).unwrap_or_default()
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
    let next_id = events.iter().map(|e| e.id).max().unwrap_or(0) + 1;
    event.id = next_id;
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
fn delete_event(app: tauri::AppHandle, id: u32) -> Result<(), String> {
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
