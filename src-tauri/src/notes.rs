use std::cmp::Ordering;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use chrono::{DateTime, Datelike, LocalResult, TimeZone, Utc};
use chrono_tz::Tz;
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
const DAY_MS: i64 = 86_400_000;
const DEADLINE_DEFAULT_LIMIT: i64 = 200;
const DEADLINE_MAX_LIMIT: i64 = 500;
const DEADLINE_PADDING_MS: i64 = DAY_MS * 2;

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NotesDeadlineRangePage {
    #[serde(default)]
    pub items: Vec<Note>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cursor: Option<String>,
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

fn normalise_deadline_limit(limit: Option<i64>) -> i64 {
    limit
        .map(|value| value.clamp(1, DEADLINE_MAX_LIMIT))
        .unwrap_or(DEADLINE_DEFAULT_LIMIT)
}

fn parse_timezone(value: Option<&str>) -> Option<Tz> {
    value.and_then(|name| {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            None
        } else {
            trimmed.parse::<Tz>().ok()
        }
    })
}

fn ms_to_utc_datetime(ms: i64) -> Option<DateTime<Utc>> {
    let secs = ms.div_euclid(1000);
    let nanos = (ms.rem_euclid(1000) * 1_000_000) as u32;
    DateTime::<Utc>::from_timestamp(secs, nanos)
}

fn day_start_utc(deadline_ms: i64, tz: Tz) -> Option<i64> {
    let deadline = ms_to_utc_datetime(deadline_ms)?;
    let local = deadline.with_timezone(&tz);
    let date = local.date_naive();
    let start_local = match tz.with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0) {
        LocalResult::None => return None,
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(dt1, dt2) => dt1.min(dt2),
    };
    Some(start_local.with_timezone(&Utc).timestamp_millis())
}

fn window_start_bound(start: i64) -> i64 {
    start.saturating_sub(DEADLINE_PADDING_MS)
}

fn window_end_bound(end: i64) -> i64 {
    end.saturating_add(DEADLINE_PADDING_MS)
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

async fn list_deadline_candidates(
    pool: &SqlitePool,
    household_id: &str,
    after: Option<(i64, String)>,
    limit: i64,
    category_ids: &[String],
    start: i64,
    end: i64,
) -> AppResult<Vec<Note>> {
    let mut sql = format!(
        "SELECT {NOTE_SELECT_FIELDS} FROM notes WHERE household_id = ? AND deleted_at IS NULL AND deadline IS NOT NULL AND deadline >= ? AND deadline <= ?"
    );
    if after.is_some() {
        sql.push_str(" AND (deadline > ? OR (deadline = ? AND id > ?))");
    }
    if !category_ids.is_empty() {
        let placeholders = vec!["?"; category_ids.len()].join(",");
        sql.push_str(" AND category_id IN (");
        sql.push_str(&placeholders);
        sql.push(')');
    }
    sql.push_str(" ORDER BY deadline, id LIMIT ?");

    let mut query = sqlx::query_as::<_, Note>(&sql)
        .bind(household_id)
        .bind(start)
        .bind(end);

    if let Some((deadline, id)) = &after {
        query = query.bind(deadline).bind(deadline).bind(id);
    }

    for category in category_ids {
        query = query.bind(category);
    }

    query = query.bind(limit);

    let mut rows = query.fetch_all(pool).await.map_err(AppError::from)?;
    for note in &mut rows {
        if note.z.is_none() {
            note.z = Some(0);
        }
    }
    Ok(rows)
}

async fn list_deadline_range_page(
    pool: &SqlitePool,
    household_id: &str,
    start_utc: i64,
    end_utc: i64,
    category_ids: Option<Vec<String>>,
    cursor: Option<String>,
    limit: Option<i64>,
    viewer_tz: Option<String>,
) -> AppResult<NotesDeadlineRangePage> {
    repo::require_household(household_id).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "notes_list_by_deadline_range")
            .with_context("table", "notes".to_string())
    })?;

    if end_utc < start_utc {
        return Ok(NotesDeadlineRangePage {
            items: Vec::new(),
            cursor: None,
        });
    }

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
        return Ok(NotesDeadlineRangePage {
            items: Vec::new(),
            cursor: None,
        });
    }

    let limit = normalise_deadline_limit(limit);
    let fetch_limit = limit.saturating_add(1);
    let after = decode_cursor(cursor)?;
    let viewer_zone = parse_timezone(viewer_tz.as_deref()).unwrap_or(Tz::UTC);
    let mut collected: Vec<(Note, i64)> = Vec::new();
    let mut next_after = after;
    let mut needs_cursor = false;
    let start_bound = window_start_bound(start_utc);
    let end_bound = window_end_bound(end_utc);

    loop {
        let candidates = list_deadline_candidates(
            pool,
            household_id,
            next_after.clone(),
            fetch_limit,
            &filter_categories,
            start_bound,
            end_bound,
        )
        .await?;

        if candidates.is_empty() {
            break;
        }

        let mut progressed = false;
        let candidates_len = candidates.len();

        for mut note in candidates {
            let deadline_ms = match note.deadline {
                Some(value) => value,
                None => continue,
            };
            let cursor_key = (deadline_ms, note.id.clone());
            next_after = Some(cursor_key);
            progressed = true;

            let tz = parse_timezone(note.deadline_tz.as_deref()).unwrap_or(viewer_zone);
            if let Some(day_start) = day_start_utc(deadline_ms, tz) {
                if day_start < start_utc || day_start > end_utc {
                    continue;
                }
                if note.z.is_none() {
                    note.z = Some(0);
                }
                collected.push((note, deadline_ms));
                if collected.len() as i64 > limit {
                    needs_cursor = true;
                    break;
                }
            }
        }

        if needs_cursor || !progressed {
            break;
        }

        if (candidates_len as i64) < fetch_limit {
            break;
        }

        if let Some((deadline, _)) = next_after {
            if deadline > end_bound {
                break;
            }
        }
    }

    let mut cursor_token = None;
    if collected.len() as i64 > limit {
        if let Some((cursor_note, cursor_deadline)) = collected.get(limit as usize - 1) {
            cursor_token = Some(encode_cursor(*cursor_deadline, &cursor_note.id));
        }
        collected.truncate(limit as usize);
    }

    let items = collected.into_iter().map(|(note, _)| note).collect();
    Ok(NotesDeadlineRangePage {
        items,
        cursor: cursor_token,
    })
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
pub async fn notes_list_by_deadline_range(
    state: State<'_, AppState>,
    household_id: String,
    start_utc: i64,
    end_utc: i64,
    category_ids: Option<Vec<String>>,
    cursor: Option<String>,
    limit: Option<i64>,
    viewer_tz: Option<String>,
) -> AppResult<NotesDeadlineRangePage> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        let household_id = household_id.clone();
        let category_ids = category_ids.clone();
        let cursor = cursor.clone();
        let viewer_tz = viewer_tz.clone();
        async move {
            list_deadline_range_page(
                &pool,
                &household_id,
                start_utc,
                end_utc,
                category_ids,
                cursor,
                limit,
                viewer_tz,
            )
            .await
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
        let mut data = data.clone();
        async move {
            let household_id = data
                .get("household_id")
                .and_then(|value| value.as_str())
                .ok_or_else(|| AppError::new("NOTES/CREATE", "household_id is required"))?
                .to_owned();

            let position_missing = match data.get("position") {
                Some(Value::Number(number)) if number.as_i64().is_some() => false,
                _ => true,
            };
            if position_missing {
                let next_position: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM notes WHERE household_id = ?1 AND deleted_at IS NULL",
                )
                .bind(&household_id)
                .fetch_one(&pool)
                .await
                .map_err(AppError::from)?;
                data.insert("position".into(), Value::from(next_position));
            }

            let z_missing = match data.get("z") {
                Some(Value::Number(number)) if number.as_i64().is_some() => false,
                _ => true,
            };
            if z_missing {
                let next_z: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(z), 0) + 1 FROM notes WHERE household_id = ?1 AND deleted_at IS NULL",
                )
                .bind(&household_id)
                .fetch_one(&pool)
                .await
                .map_err(AppError::from)?;
                data.insert("z".into(), Value::from(next_z));
            }

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
    use chrono::TimeZone;
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

    async fn insert_deadline_note(
        pool: &SqlitePool,
        household_id: &str,
        position: i64,
        id: &str,
        text: &str,
        deadline_ms: i64,
        deadline_tz: Option<&str>,
        category_id: Option<&str>,
    ) -> String {
        let mut payload = Map::new();
        payload.insert("id".into(), Value::String(id.into()));
        payload.insert("household_id".into(), Value::String(household_id.into()));
        match category_id {
            Some(value) => payload.insert("category_id".into(), Value::String(value.into())),
            None => payload.insert("category_id".into(), Value::Null),
        };
        payload.insert("text".into(), Value::String(text.into()));
        payload.insert("color".into(), Value::String("#FFF4B8".into()));
        payload.insert("x".into(), json!(0.0));
        payload.insert("y".into(), json!(0.0));
        payload.insert("position".into(), Value::from(position));
        payload.insert("deadline".into(), Value::from(deadline_ms));
        if let Some(tz) = deadline_tz {
            payload.insert("deadline_tz".into(), Value::String(tz.into()));
        }

        commands::create_command(pool, "notes", payload)
            .await
            .expect("create deadline note")
            .get("id")
            .and_then(|value| value.as_str())
            .map(|s| s.to_string())
            .expect("note id")
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
        assert!(
            ids_one.iter().all(|id| !ids_two.contains(id)),
            "no duplicates"
        );

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
        assert_eq!(
            page_three.notes.len(),
            5,
            "final page has remaining results"
        );
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

        // Reuse an existing primary category for the default household when present
        // to avoid violating the unique (household_id, slug) constraint.
        let existing: Option<String> = sqlx::query_scalar(
            r#"
            SELECT id
              FROM categories
             WHERE household_id = 'default'
               AND slug = 'primary'
               AND deleted_at IS NULL
            "#,
        )
        .fetch_optional(&pool)
        .await
        .expect("query primary category");

        let category_id = if let Some(id) = existing {
            id
        } else {
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                r#"
                INSERT INTO categories
                  (id, household_id, name, slug, color, position, z, is_visible, created_at, updated_at, deleted_at)
                VALUES
                  (?, 'default', 'Primary', 'primary', '#4F46E5', 0, 0, 1, strftime('%s','now')*1000, strftime('%s','now')*1000, NULL)
                "#,
            )
            .bind(&id)
            .execute(&pool)
            .await
            .expect("seed primary category");
            id
        };

        let mut payload = Map::new();
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

    #[tokio::test]
    async fn notes_deadline_range_filters_by_household() {
        let pool = setup_pool().await;
        let start = 1_700_000_000_000_i64 - DAY_MS;
        let end = 1_700_000_000_000_i64 + DAY_MS;

        let default_note_id = insert_deadline_note(
            &pool,
            "default",
            0,
            "note-default",
            "Default household note",
            1_700_000_000_000,
            Some("UTC"),
            None,
        )
        .await;

        sqlx::query(
            "INSERT INTO household (id, name, tz, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        )
        .bind("other")
        .bind("Other Household")
        .bind("UTC")
        .bind(1_672_531_200_000_i64)
        .bind(1_672_531_200_000_i64)
        .execute(&pool)
        .await
        .expect("insert household");

        let other_note_id = insert_deadline_note(
            &pool,
            "other",
            0,
            "note-other",
            "Other household note",
            1_700_000_500_000,
            Some("UTC"),
            None,
        )
        .await;

        let default_page = list_deadline_range_page(
            &pool,
            "default",
            start,
            end,
            None,
            None,
            Some(10),
            Some("UTC".into()),
        )
        .await
        .expect("fetch default household notes");
        assert_eq!(default_page.items.len(), 1);
        assert_eq!(default_page.items[0].id, default_note_id);

        let other_page = list_deadline_range_page(
            &pool,
            "other",
            start,
            end,
            None,
            None,
            Some(10),
            Some("UTC".into()),
        )
        .await
        .expect("fetch other household notes");
        assert_eq!(other_page.items.len(), 1);
        assert_eq!(other_page.items[0].id, other_note_id);
    }

    #[tokio::test]
    async fn notes_deadline_range_respects_category_filter() {
        let pool = setup_pool().await;
        let base_deadline = 1_700_100_000_000_i64;
        insert_deadline_note(
            &pool,
            "default",
            1,
            "note-primary",
            "Primary",
            base_deadline,
            Some("UTC"),
            Some("cat_primary"),
        )
        .await;
        insert_deadline_note(
            &pool,
            "default",
            2,
            "note-secondary",
            "Secondary",
            base_deadline + 60_000,
            Some("UTC"),
            Some("cat_secondary"),
        )
        .await;

        let page = list_deadline_range_page(
            &pool,
            "default",
            base_deadline - DAY_MS,
            base_deadline + DAY_MS,
            Some(vec!["cat_primary".to_string()]),
            None,
            Some(10),
            Some("UTC".into()),
        )
        .await
        .expect("fetch filtered notes");
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "note-primary");
    }

    #[tokio::test]
    async fn notes_deadline_range_handles_dst_midnight() {
        let pool = setup_pool().await;
        let london_tz = parse_timezone(Some("Europe/London")).expect("parse tz");
        let local = london_tz
            .with_ymd_and_hms(2025, 3, 30, 0, 0, 0)
            .single()
            .expect("construct local time");
        let deadline_ms = local.timestamp_millis();
        insert_deadline_note(
            &pool,
            "default",
            3,
            "note-dst",
            "DST note",
            deadline_ms,
            Some("Europe/London"),
            None,
        )
        .await;

        let day_start = day_start_utc(deadline_ms, london_tz).expect("day start");
        let page = list_deadline_range_page(
            &pool,
            "default",
            day_start - DAY_MS,
            day_start + DAY_MS,
            None,
            None,
            Some(5),
            Some("America/New_York".into()),
        )
        .await
        .expect("fetch dst note");
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "note-dst");
    }

    #[tokio::test]
    async fn notes_deadline_range_paginates_by_deadline_then_id() {
        let pool = setup_pool().await;
        let deadline_ms = 1_700_200_000_000_i64;
        insert_deadline_note(
            &pool,
            "default",
            0,
            "note-a",
            "A",
            deadline_ms,
            Some("UTC"),
            None,
        )
        .await;
        insert_deadline_note(
            &pool,
            "default",
            1,
            "note-b",
            "B",
            deadline_ms,
            Some("UTC"),
            None,
        )
        .await;
        insert_deadline_note(
            &pool,
            "default",
            2,
            "note-c",
            "C",
            deadline_ms + 60_000,
            Some("UTC"),
            None,
        )
        .await;

        let first_page = list_deadline_range_page(
            &pool,
            "default",
            deadline_ms - DAY_MS,
            deadline_ms + DAY_MS,
            None,
            None,
            Some(2),
            Some("UTC".into()),
        )
        .await
        .expect("fetch first page");
        assert_eq!(first_page.items.len(), 2);
        assert_eq!(first_page.items[0].id, "note-a");
        assert_eq!(first_page.items[1].id, "note-b");
        let cursor = first_page.cursor.clone().expect("cursor present");
        let decoded = decode_cursor(Some(cursor.clone())).expect("decode cursor");
        assert!(decoded.is_some(), "cursor decodes");

        let second_page = list_deadline_range_page(
            &pool,
            "default",
            deadline_ms - DAY_MS,
            deadline_ms + DAY_MS,
            None,
            Some(cursor),
            Some(2),
            Some("UTC".into()),
        )
        .await
        .expect("fetch second page");
        assert_eq!(second_page.items.len(), 1);
        assert_eq!(second_page.items[0].id, "note-c");
    }
}
