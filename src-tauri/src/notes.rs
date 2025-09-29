use std::cmp::Ordering;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqlitePool;
use tauri::State;
use ts_rs::TS;

use crate::{
    commands, ipc::guard, repo, state::AppState, util::dispatch_async_app_result, AppError,
    AppResult,
};

const DEFAULT_PAGE_SIZE: i64 = 20;
const MAX_PAGE_SIZE: i64 = 100;
const NOTE_SELECT_FIELDS: &str =
    "id, household_id, category_id, position, created_at, updated_at, deleted_at, text, color, x, y, z, deadline, deadline_tz";

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Note {
    pub id: String,
    pub household_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub category_id: Option<String>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deleted_at: Option<i64>,
    pub text: String,
    pub color: String,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub z: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deadline: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub deadline_tz: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NotesPage {
    pub notes: Vec<Note>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_cursor: Option<String>,
}

fn decode_cursor(cursor: Option<String>) -> AppResult<Option<(i64, String)>> {
    if let Some(cursor) = cursor {
        if cursor.trim().is_empty() {
            return Ok(None);
        }
        let decoded = STANDARD_NO_PAD.decode(cursor.as_bytes()).map_err(|err| {
            AppError::new("NOTES/CURSOR_DECODE", "Failed to decode cursor")
                .with_context("cause", err.to_string())
        })?;
        let decoded_str = String::from_utf8(decoded).map_err(|err| {
            AppError::new("NOTES/CURSOR_DECODE", "Failed to decode cursor")
                .with_context("cause", err.to_string())
        })?;
        let mut parts = decoded_str.splitn(2, ':');
        let created_at = parts
            .next()
            .ok_or_else(|| AppError::new("NOTES/CURSOR_INVALID", "Cursor missing created_at"))?;
        let id = parts
            .next()
            .ok_or_else(|| AppError::new("NOTES/CURSOR_INVALID", "Cursor missing id"))?;
        let created_at = created_at.parse::<i64>().map_err(|err| {
            AppError::new("NOTES/CURSOR_INVALID", "Cursor contains invalid created_at")
                .with_context("cause", err.to_string())
        })?;
        Ok(Some((created_at, id.to_string())))
    } else {
        Ok(None)
    }
}

fn encode_cursor(created_at: i64, id: &str) -> String {
    let value = format!("{}:{}", created_at, id);
    STANDARD_NO_PAD.encode(value.as_bytes())
}

async fn fetch_note(
    pool: &SqlitePool,
    household_id: Option<&str>,
    id: &str,
) -> AppResult<Option<Note>> {
    let value = commands::get_command(pool, "notes", household_id, id).await?;
    match value {
        Some(value) => {
            let mut note: Note = serde_json::from_value(value.clone()).map_err(|err| {
                AppError::new("NOTES/DECODE", "Failed to decode note")
                    .with_context("cause", err.to_string())
            })?;
            if note.z.is_none() {
                // Historical rows defaulted z to 0; ensure a deterministic default.
                note.z = Some(0);
            }
            Ok(Some(note))
        }
        None => Ok(None),
    }
}

fn normalise_limit(limit: Option<i64>) -> i64 {
    limit
        .map(|value| value.clamp(1, MAX_PAGE_SIZE))
        .unwrap_or(DEFAULT_PAGE_SIZE)
}

async fn list_page(
    pool: &SqlitePool,
    household_id: &str,
    after: Option<(i64, String)>,
    limit: i64,
    category_ids: Option<Vec<String>>,
    include_deleted: bool,
) -> AppResult<Vec<Note>> {
    repo::require_household(household_id).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "list_cursor")
            .with_context("table", "notes".to_string())
    })?;

    let (filter_categories, had_filter) = match category_ids {
        Some(ids) => {
            let filtered = ids
                .into_iter()
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty())
                .collect::<Vec<_>>();
            (filtered, true)
        }
        None => (Vec::new(), false),
    };

    if had_filter && filter_categories.is_empty() {
        // Explicitly requested categories but none resolved to ids.
        return Ok(Vec::new());
    }

    let mut sql = format!("SELECT {NOTE_SELECT_FIELDS} FROM notes WHERE household_id = ?");
    if !include_deleted {
        sql.push_str(" AND deleted_at IS NULL");
    }

    if after.is_some() {
        sql.push_str(" AND (created_at > ? OR (created_at = ? AND id > ?))");
    }

    if !filter_categories.is_empty() {
        let placeholders = vec!["?"; filter_categories.len()].join(",");
        sql.push_str(" AND category_id IN (");
        sql.push_str(&placeholders);
        sql.push(')');
    }

    sql.push_str(" ORDER BY created_at, id LIMIT ?");

    let mut query = sqlx::query_as::<_, Note>(&sql).bind(household_id);
    if let Some((created_at, id)) = &after {
        query = query.bind(created_at).bind(created_at).bind(id);
    }
    for category in &filter_categories {
        query = query.bind(category);
    }
    query = query.bind(limit + 1);

    let mut rows = query.fetch_all(pool).await.map_err(AppError::from)?;
    for note in &mut rows {
        if note.z.is_none() {
            note.z = Some(0);
        }
    }
    Ok(rows)
}

fn paginate(mut notes: Vec<Note>, limit: i64) -> NotesPage {
    let mut next_cursor = None;
    if notes.len() as i64 > limit {
        notes.sort_by(|a, b| match a.created_at.cmp(&b.created_at) {
            Ordering::Equal => a.id.cmp(&b.id),
            other => other,
        });
        if let Some(note) = notes.get(limit as usize - 1) {
            next_cursor = Some(encode_cursor(note.created_at, &note.id));
        }
        notes.truncate(limit as usize);
    }
    NotesPage { notes, next_cursor }
}

#[tauri::command]
pub async fn notes_list_cursor(
    state: State<'_, AppState>,
    household_id: String,
    after_cursor: Option<String>,
    limit: Option<i64>,
    category_ids: Option<Vec<String>>,
    include_deleted: Option<bool>,
) -> AppResult<NotesPage> {
    let pool = state.pool_clone();
    let include_deleted = include_deleted.unwrap_or(false);
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let category_ids = category_ids.clone();
        async move {
            let after = decode_cursor(after_cursor)?;
            let limit = normalise_limit(limit);
            let mut notes = list_page(
                &pool,
                &household_id,
                after,
                limit,
                category_ids,
                include_deleted,
            )
            .await?;
            notes.sort_by(|a, b| match a.created_at.cmp(&b.created_at) {
                Ordering::Equal => a.id.cmp(&b.id),
                other => other,
            });
            Ok(paginate(notes, limit))
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_get(
    state: State<'_, AppState>,
    household_id: Option<String>,
    id: String,
) -> AppResult<Option<Note>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move { fetch_note(&pool, household_id.as_deref(), &id).await }
    })
    .await
}

#[tauri::command]
pub async fn notes_create(state: State<'_, AppState>, data: Map<String, Value>) -> AppResult<Note> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let data = data.clone();
        async move {
            let value = commands::create_command(&pool, "notes", data).await?;
            let mut note: Note = serde_json::from_value(value).map_err(|err| {
                AppError::new("NOTES/DECODE", "Failed to decode note")
                    .with_context("cause", err.to_string())
            })?;
            if note.z.is_none() {
                note.z = Some(0);
            }
            Ok(note)
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_update(
    state: State<'_, AppState>,
    id: String,
    data: Map<String, Value>,
    household_id: Option<String>,
) -> AppResult<Note> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let id = id.clone();
        let data = data.clone();
        let household_id = household_id.clone();
        async move {
            commands::update_command(&pool, "notes", &id, data, household_id.as_deref()).await?;
            fetch_note(&pool, household_id.as_deref(), &id)
                .await?
                .ok_or_else(|| AppError::new("NOTES/NOT_FOUND", "Note not found after update"))
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move { commands::delete_command(&pool, "notes", &household_id, &id).await }
    })
    .await
}

#[tauri::command]
pub async fn notes_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<Note> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let id = id.clone();
        async move {
            commands::restore_command(&pool, "notes", &household_id, &id).await?;
            fetch_note(&pool, Some(&household_id), &id)
                .await?
                .ok_or_else(|| AppError::new("NOTES/NOT_FOUND", "Note not found after restore"))
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{commands, migrate};
    use serde_json::{json, Map, Value};
    use sqlx::SqlitePool;
    use uuid::Uuid;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect sqlite memory");
        migrate::apply_migrations(&pool)
            .await
            .expect("apply migrations");
        pool
    }

    fn note_payload(text: &str, position: i64) -> Map<String, Value> {
        let mut data = Map::new();
        data.insert("household_id".into(), Value::String("default".into()));
        data.insert("category_id".into(), Value::String("cat_primary".into()));
        data.insert("text".into(), Value::String(text.into()));
        data.insert("color".into(), Value::String("#FFF4B8".into()));
        data.insert("x".into(), json!(0.0));
        data.insert("y".into(), json!(0.0));
        data.insert("position".into(), Value::from(position));
        data
    }

    #[tokio::test]
    async fn notes_cursor_pagination() {
        let pool = setup_pool().await;
        for idx in 0..25 {
            let payload = note_payload(&format!("note-{idx}"), idx);
            commands::create_command(&pool, "notes", payload)
                .await
                .expect("create note");
        }

        let raw_page_one = list_page(&pool, "default", None, 10, None, false)
            .await
            .expect("list first page");
        let page_one = paginate(raw_page_one, 10);
        assert_eq!(page_one.notes.len(), 10, "first page has 10 results");
        let cursor = page_one.next_cursor.clone().expect("next cursor present");

        let decoded = decode_cursor(Some(cursor.clone()))
            .expect("decode cursor")
            .expect("cursor values");
        let raw_page_two = list_page(&pool, "default", Some(decoded), 10, None, false)
            .await
            .expect("list second page");
        let page_two = paginate(raw_page_two, 10);
        assert_eq!(page_two.notes.len(), 10, "second page has 10 results");

        let ids_one: Vec<_> = page_one.notes.iter().map(|n| n.id.clone()).collect();
        let ids_two: Vec<_> = page_two.notes.iter().map(|n| n.id.clone()).collect();
        assert!(ids_one.iter().all(|id| !ids_two.contains(id)), "no duplicates");

        let raw_page_three = list_page(
            &pool,
            "default",
            decode_cursor(page_two.next_cursor.clone()).unwrap(),
            10,
            None,
            false,
        )
        .await
        .expect("list third page");
        let page_three = paginate(raw_page_three, 10);
        assert_eq!(page_three.notes.len(), 5, "final page has remaining results");
    }

    #[tokio::test]
    async fn notes_deadline_fields_roundtrip() {
        let pool = setup_pool().await;
        let mut payload = note_payload("deadline-test", 0);
        payload.insert("deadline".into(), Value::from(1_700_000_000_000_i64));
        payload.insert("deadline_tz".into(), Value::String("UTC".into()));
        let note_id = commands::create_command(&pool, "notes", payload)
            .await
            .expect("create note")
            .get("id")
            .and_then(|value| value.as_str())
            .map(|s| s.to_string())
            .expect("id assigned");

        let fetched = fetch_note(&pool, Some("default"), &note_id)
            .await
            .expect("fetch note")
            .expect("note present");
        assert_eq!(fetched.deadline, Some(1_700_000_000_000));
        assert_eq!(fetched.deadline_tz.as_deref(), Some("UTC"));
    }

    #[tokio::test]
    async fn notes_quick_capture_defaults() {
        let pool = setup_pool().await;
        let mut payload = Map::new();
        let category_id = Uuid::now_v7().to_string();
        payload.insert("household_id".into(), Value::String("default".into()));
        payload.insert("category_id".into(), Value::String(category_id.clone()));
        payload.insert("text".into(), Value::String("Quick capture".into()));
        payload.insert("color".into(), Value::String("#FFF4B8".into()));
        payload.insert("x".into(), json!(12.0));
        payload.insert("y".into(), json!(24.0));
        payload.insert("position".into(), Value::from(42));
        payload.insert("deadline".into(), Value::from(1_700_100_000_000_i64));
        payload.insert("deadline_tz".into(), Value::String("Europe/Dublin".into()));

        let created = commands::create_command(&pool, "notes", payload)
            .await
            .expect("create quick note");
        let id = created
            .get("id")
            .and_then(|value| value.as_str())
            .map(|s| s.to_string())
            .expect("note id");

        let fetched = fetch_note(&pool, Some("default"), &id)
            .await
            .expect("fetch created")
            .expect("note exists");
        assert_eq!(fetched.category_id.as_deref(), Some(category_id.as_str()));
        assert_eq!(fetched.text, "Quick capture");
        assert_eq!(fetched.deadline, Some(1_700_100_000_000));
        assert_eq!(fetched.deadline_tz.as_deref(), Some("Europe/Dublin"));
        assert_eq!(fetched.z.unwrap_or_default(), 0);
    }
}
