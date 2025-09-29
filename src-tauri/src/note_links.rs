use std::fmt;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sqlx::{
    encode::IsNull,
    error::BoxDynError,
    sqlite::{SqliteArgumentValue, SqliteTypeInfo, SqliteValueRef},
    Executor, Sqlite, SqlitePool, Transaction,
};
use tauri::State;
use ts_rs::TS;

use crate::{
    id::new_uuid_v7, ipc::guard, notes::Note, repo, state::AppState, time::now_ms,
    util::dispatch_async_app_result, AppError, AppResult,
};

const DEFAULT_PAGE_SIZE: i64 = 20;
const MAX_PAGE_SIZE: i64 = 100;
const DEFAULT_RELATION: &str = "attached_to";
const DEFAULT_NOTE_COLOR: &str = "#FFF4B8";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum NoteLinkEntityType {
    Event,
    File,
}

impl NoteLinkEntityType {
    pub fn as_str(&self) -> &'static str {
        match self {
            NoteLinkEntityType::Event => "event",
            NoteLinkEntityType::File => "file",
        }
    }
}

impl fmt::Display for NoteLinkEntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl sqlx::Type<Sqlite> for NoteLinkEntityType {
    fn type_info() -> SqliteTypeInfo {
        <&str as sqlx::Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <&str as sqlx::Type<Sqlite>>::compatible(ty)
    }
}

impl<'q> sqlx::Encode<'q, Sqlite> for NoteLinkEntityType {
    fn encode_by_ref(&self, buf: &mut Vec<SqliteArgumentValue<'q>>) -> Result<IsNull, BoxDynError> {
        <&str as sqlx::Encode<'q, Sqlite>>::encode_by_ref(&self.as_str(), buf)
    }
}

impl<'r> sqlx::Decode<'r, Sqlite> for NoteLinkEntityType {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let raw = <&str as sqlx::Decode<'r, Sqlite>>::decode(value)?;
        match raw {
            "event" => Ok(NoteLinkEntityType::Event),
            "file" => Ok(NoteLinkEntityType::File),
            other => Err(format!("invalid note link entity type: {other}").into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NoteLink {
    pub id: String,
    pub household_id: String,
    pub note_id: String,
    pub entity_type: NoteLinkEntityType,
    pub entity_id: String,
    pub relation: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ContextNotesPage {
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
            AppError::new(
                "NOTE_LINK/CURSOR_DECODE",
                "Failed to decode context notes cursor",
            )
            .with_context("cause", err.to_string())
        })?;
        let decoded_str = String::from_utf8(decoded).map_err(|err| {
            AppError::new(
                "NOTE_LINK/CURSOR_DECODE",
                "Failed to decode context notes cursor",
            )
            .with_context("cause", err.to_string())
        })?;
        let mut parts = decoded_str.splitn(2, ':');
        let created_at = parts.next().ok_or_else(|| {
            AppError::new(
                "NOTE_LINK/CURSOR_INVALID",
                "Cursor missing created_at field",
            )
        })?;
        let id = parts
            .next()
            .ok_or_else(|| AppError::new("NOTE_LINK/CURSOR_INVALID", "Cursor missing id"))?;
        let created_at = created_at.parse::<i64>().map_err(|err| {
            AppError::new(
                "NOTE_LINK/CURSOR_INVALID",
                "Cursor contains invalid created_at",
            )
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

fn normalise_limit(limit: Option<i64>) -> i64 {
    limit
        .map(|value| value.clamp(1, MAX_PAGE_SIZE))
        .unwrap_or(DEFAULT_PAGE_SIZE)
}

fn empty_category_filter(category_ids: &Option<Vec<String>>) -> bool {
    matches!(category_ids, Some(ids) if ids.is_empty())
}

async fn ensure_note_in_household<'e, E>(
    executor: E,
    household_id: &str,
    note_id: &str,
) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    let note_hh: Option<String> =
        sqlx::query_scalar("SELECT household_id FROM notes WHERE id = ? AND deleted_at IS NULL")
            .bind(note_id)
            .fetch_optional(executor)
            .await
            .map_err(AppError::from)?;

    match note_hh {
        Some(ref hh) if hh == household_id => Ok(()),
        Some(_) => Err(AppError::new(
            "NOTE_LINK/CROSS_HOUSEHOLD",
            "Note belongs to a different household",
        )
        .with_context("note_id", note_id.to_string())
        .with_context("household_id", household_id.to_string())),
        None => Err(
            AppError::new("NOTE_LINK/ENTITY_NOT_FOUND", "Note not found")
                .with_context("note_id", note_id.to_string()),
        ),
    }
}

async fn ensure_entity_in_household<'e, E>(
    executor: E,
    household_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    let (sql, not_found_label) = match entity_type {
        NoteLinkEntityType::Event => (
            "SELECT household_id FROM events WHERE id = ? AND deleted_at IS NULL",
            "event",
        ),
        NoteLinkEntityType::File => (
            "SELECT household_id FROM files_index WHERE file_id = ?",
            "file",
        ),
    };

    let entity_hh: Option<String> = sqlx::query_scalar(sql)
        .bind(entity_id)
        .fetch_optional(executor)
        .await
        .map_err(AppError::from)?;

    match entity_hh {
        Some(ref hh) if hh == household_id => Ok(()),
        Some(_) => Err(AppError::new(
            "NOTE_LINK/CROSS_HOUSEHOLD",
            "Entity belongs to a different household",
        )
        .with_context("entity_type", entity_type.to_string())
        .with_context("entity_id", entity_id.to_string())
        .with_context("household_id", household_id.to_string())),
        None => Err(AppError::new(
            "NOTE_LINK/ENTITY_NOT_FOUND",
            format!("{} not found", not_found_label),
        )
        .with_context("entity_type", entity_type.to_string())
        .with_context("entity_id", entity_id.to_string())),
    }
}

pub async fn ensure_same_household(
    pool: &SqlitePool,
    household_id: &str,
    note_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
) -> AppResult<()> {
    ensure_note_in_household(pool, household_id, note_id).await?;
    ensure_entity_in_household(pool, household_id, entity_type, entity_id).await?;
    Ok(())
}

async fn ensure_same_household_tx(
    tx: &mut Transaction<'_, Sqlite>,
    household_id: &str,
    note_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
) -> AppResult<()> {
    ensure_note_in_household(tx.as_mut(), household_id, note_id).await?;
    ensure_entity_in_household(tx.as_mut(), household_id, entity_type, entity_id).await?;
    Ok(())
}

async fn ensure_entity_exists_tx(
    tx: &mut Transaction<'_, Sqlite>,
    household_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
) -> AppResult<()> {
    ensure_entity_in_household(tx.as_mut(), household_id, entity_type, entity_id).await
}

async fn create_link_with_tx(
    tx: &mut Transaction<'_, Sqlite>,
    household_id: &str,
    note_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
    relation: Option<&str>,
) -> AppResult<NoteLink> {
    ensure_same_household_tx(tx, household_id, note_id, entity_type, entity_id).await?;

    let id = new_uuid_v7();
    let relation = relation.unwrap_or(DEFAULT_RELATION);
    let now = now_ms();

    let insert_result = sqlx::query(
        "INSERT INTO note_links (id, household_id, note_id, entity_type, entity_id, relation, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
    )
    .bind(&id)
    .bind(household_id)
    .bind(note_id)
    .bind(entity_type.as_str())
    .bind(entity_id)
    .bind(relation)
    .bind(now)
    .execute(tx.as_mut())
    .await;

    if let Err(err) = insert_result {
        if let sqlx::Error::Database(db_err) = &err {
            let is_unique = db_err.code().as_deref() == Some("2067")
                || db_err.message().starts_with("UNIQUE constraint failed");
            if is_unique {
                return Err(AppError::new(
                    "NOTE_LINK/ALREADY_EXISTS",
                    "Note is already linked to this entity",
                )
                .with_context("note_id", note_id.to_string())
                .with_context("entity_type", entity_type.to_string())
                .with_context("entity_id", entity_id.to_string()));
            }
        }
        return Err(AppError::from(err)
            .with_context("operation", "note_links_create")
            .with_context("note_id", note_id.to_string())
            .with_context("entity_type", entity_type.to_string())
            .with_context("entity_id", entity_id.to_string()));
    }

    let mut link: NoteLink = sqlx::query_as(
        "SELECT id,
                household_id,
                note_id,
                entity_type,
                entity_id,
                relation,
                created_at,
                updated_at
           FROM note_links
          WHERE id = ?1",
    )
    .bind(&id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "note_links_create_fetch")
            .with_context("link_id", id.clone())
    })?;
    link.relation = relation.to_string();
    Ok(link)
}

pub async fn create_link(
    pool: &SqlitePool,
    household_id: &str,
    note_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
    relation: Option<&str>,
) -> AppResult<NoteLink> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "note_links_create_tx"))?;
    let link = create_link_with_tx(
        &mut tx,
        household_id,
        note_id,
        entity_type,
        entity_id,
        relation,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "note_links_create_commit"))?;
    tracing::debug!(
        target = "contextual-notes",
        action = "create_link",
        link_id = %link.id,
        note_id = %note_id,
        entity_type = %entity_type,
        entity_id = %entity_id,
        household_id = %household_id,
        relation = %link.relation
    );
    Ok(link)
}

pub async fn delete_link(pool: &SqlitePool, household_id: &str, link_id: &str) -> AppResult<()> {
    let existing: Option<(String, NoteLinkEntityType, String)> = sqlx::query_as(
        "SELECT note_id,
                entity_type,
                entity_id
           FROM note_links
          WHERE id = ?1 AND household_id = ?2",
    )
    .bind(link_id)
    .bind(household_id)
    .fetch_optional(pool)
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "note_links_delete")
            .with_context("link_id", link_id.to_string())
    })?;

    let Some(existing) = existing else {
        return Err(
            AppError::new("NOTE_LINK/ENTITY_NOT_FOUND", "Note link not found")
                .with_context("link_id", link_id.to_string()),
        );
    };

    let rows = sqlx::query("DELETE FROM note_links WHERE id = ?1 AND household_id = ?2")
        .bind(link_id)
        .bind(household_id)
        .execute(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "note_links_delete")
                .with_context("link_id", link_id.to_string())
        })?;

    if rows.rows_affected() == 0 {
        return Err(
            AppError::new("NOTE_LINK/ENTITY_NOT_FOUND", "Note link not found")
                .with_context("link_id", link_id.to_string()),
        );
    }

    tracing::debug!(
        target = "contextual-notes",
        action = "delete_link",
        link_id = %link_id,
        note_id = %existing.0,
        entity_type = %existing.1,
        entity_id = %existing.2,
        household_id = %household_id
    );

    Ok(())
}

pub async fn quick_create_note_for_entity(
    pool: &SqlitePool,
    household_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
    category_id: &str,
    text: &str,
    color: Option<&str>,
) -> AppResult<Note> {
    let mut tx = pool.begin().await.map_err(|err| {
        AppError::from(err).with_context("operation", "notes_quick_create_for_entity_tx")
    })?;

    ensure_entity_exists_tx(&mut tx, household_id, entity_type, entity_id).await?;
    let note = create_note_for_entity(&mut tx, household_id, category_id, text, color).await?;
    let link = create_link_with_tx(
        &mut tx,
        household_id,
        &note.id,
        entity_type,
        entity_id,
        None,
    )
    .await?;
    tx.commit().await.map_err(|err| {
        AppError::from(err).with_context("operation", "notes_quick_create_for_entity_commit")
    })?;

    tracing::debug!(
        target = "contextual-notes",
        action = "create_link",
        link_id = %link.id,
        note_id = %note.id,
        entity_type = %entity_type,
        entity_id = %entity_id,
        household_id = %household_id,
        relation = %link.relation
    );

    Ok(note)
}

pub async fn list_notes_for_entity(
    pool: &SqlitePool,
    household_id: &str,
    entity_type: NoteLinkEntityType,
    entity_id: &str,
    category_ids: Option<Vec<String>>,
    cursor: Option<String>,
    limit: Option<i64>,
) -> AppResult<ContextNotesPage> {
    ensure_entity_in_household(pool, household_id, entity_type, entity_id).await?;

    if empty_category_filter(&category_ids) {
        return Ok(ContextNotesPage {
            notes: Vec::new(),
            next_cursor: None,
        });
    }

    let after = decode_cursor(cursor)?;
    let limit = normalise_limit(limit);

    let mut sql = String::from(
        "SELECT n.id,
                n.household_id,
                n.category_id,
                n.position,
                n.created_at,
                n.updated_at,
                n.deleted_at,
                n.text,
                n.color,
                n.x,
                n.y,
                n.z,
                n.deadline,
                n.deadline_tz
           FROM note_links nl
           JOIN notes n ON n.id = nl.note_id
          WHERE nl.household_id = ?1
            AND nl.entity_type = ?2
            AND nl.entity_id = ?3
            AND n.deleted_at IS NULL",
    );

    if after.is_some() {
        sql.push_str(" AND (n.created_at > ?4 OR (n.created_at = ?4 AND n.id > ?5))");
    }

    let mut filter_categories = Vec::new();
    if let Some(ids) = category_ids {
        let filtered: Vec<String> = ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect();
        if !filtered.is_empty() {
            let placeholders = vec!["?"; filtered.len()].join(",");
            sql.push_str(" AND n.category_id IN (");
            sql.push_str(&placeholders);
            sql.push(')');
        }
        filter_categories = filtered;
    }

    sql.push_str(" ORDER BY n.created_at, n.id LIMIT ?");

    let mut query = sqlx::query_as::<_, Note>(&sql)
        .bind(household_id)
        .bind(entity_type.as_str())
        .bind(entity_id);

    if let Some((created_at, id)) = &after {
        query = query.bind(created_at).bind(id);
    }

    for category in &filter_categories {
        query = query.bind(category);
    }

    query = query.bind(limit + 1);

    let mut rows = query
        .fetch_all(pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "notes_list_for_entity"))?;

    for note in &mut rows {
        if note.z.is_none() {
            note.z = Some(0);
        }
    }

    rows.sort_by(|a, b| match a.created_at.cmp(&b.created_at) {
        std::cmp::Ordering::Equal => a.id.cmp(&b.id),
        other => other,
    });

    let mut next_cursor = None;
    if rows.len() as i64 > limit {
        if let Some(note) = rows.get(limit as usize - 1) {
            next_cursor = Some(encode_cursor(note.created_at, &note.id));
        }
        rows.truncate(limit as usize);
    }

    Ok(ContextNotesPage {
        notes: rows,
        next_cursor,
    })
}

async fn create_note_for_entity(
    tx: &mut Transaction<'_, Sqlite>,
    household_id: &str,
    category_id: &str,
    text: &str,
    color: Option<&str>,
) -> AppResult<Note> {
    let now = now_ms();
    let note_id = new_uuid_v7();

    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM notes WHERE household_id = ?1 AND deleted_at IS NULL",
    )
    .bind(household_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "notes_quick_create_for_entity_position")
            .with_context("household_id", household_id.to_string())
    })?;

    let z_value: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(z), 0) + 1 FROM notes WHERE household_id = ?1 AND deleted_at IS NULL",
    )
    .bind(household_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "notes_quick_create_for_entity_z")
            .with_context("household_id", household_id.to_string())
    })?;

    let color = color
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_NOTE_COLOR.to_string());

    sqlx::query(
        "INSERT INTO notes (
             id,
             household_id,
             category_id,
             position,
             created_at,
             updated_at,
             z,
             text,
             color,
             x,
             y
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, 0.0, 0.0)",
    )
    .bind(&note_id)
    .bind(household_id)
    .bind(category_id)
    .bind(position)
    .bind(now)
    .bind(z_value)
    .bind(text)
    .bind(&color)
    .execute(tx.as_mut())
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "notes_quick_create_for_entity_insert")
            .with_context("household_id", household_id.to_string())
    })?;

    let mut note: Note = sqlx::query_as(
        "SELECT id,
                household_id,
                category_id,
                position,
                created_at,
                updated_at,
                deleted_at,
                text,
                color,
                x,
                y,
                z,
                deadline,
                deadline_tz
           FROM notes
          WHERE id = ?1",
    )
    .bind(&note_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "notes_quick_create_for_entity_fetch")
            .with_context("note_id", note_id.clone())
    })?;

    if note.z.is_none() {
        note.z = Some(0);
    }

    Ok(note)
}

#[tauri::command]
pub async fn note_links_create(
    state: State<'_, AppState>,
    household_id: String,
    note_id: String,
    entity_type: NoteLinkEntityType,
    entity_id: String,
    relation: Option<String>,
) -> AppResult<NoteLink> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();

    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let note_id = note_id.clone();
        let entity_id = entity_id.clone();
        let relation = relation.clone();
        async move {
            repo::require_household(&household_id).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "note_links_create")
                    .with_context("household_id", household_id.to_string())
            })?;
            create_link(
                &pool,
                &household_id,
                &note_id,
                entity_type,
                &entity_id,
                relation.as_deref(),
            )
            .await
        }
    })
    .await
}

#[tauri::command]
pub async fn note_links_delete(
    state: State<'_, AppState>,
    household_id: String,
    link_id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();

    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let link_id = link_id.clone();
        async move {
            repo::require_household(&household_id).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "note_links_delete")
                    .with_context("household_id", household_id.to_string())
            })?;
            delete_link(&pool, &household_id, &link_id).await
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_list_for_entity(
    state: State<'_, AppState>,
    household_id: String,
    entity_type: NoteLinkEntityType,
    entity_id: String,
    category_ids: Option<Vec<String>>,
    cursor: Option<String>,
    limit: Option<i64>,
) -> AppResult<ContextNotesPage> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let entity_id = entity_id.clone();
        let category_ids = category_ids.clone();
        let cursor = cursor.clone();
        async move {
            repo::require_household(&household_id).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "notes_list_for_entity")
                    .with_context("household_id", household_id.to_string())
            })?;
            list_notes_for_entity(
                &pool,
                &household_id,
                entity_type,
                &entity_id,
                category_ids,
                cursor,
                limit,
            )
            .await
        }
    })
    .await
}

#[tauri::command]
pub async fn notes_quick_create_for_entity(
    state: State<'_, AppState>,
    household_id: String,
    entity_type: NoteLinkEntityType,
    entity_id: String,
    category_id: String,
    text: String,
    color: Option<String>,
) -> AppResult<Note> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();

    dispatch_async_app_result(move || {
        let household_id = household_id.clone();
        let entity_id = entity_id.clone();
        let category_id = category_id.clone();
        let text = text.clone();
        let color = color.clone();
        async move {
            repo::require_household(&household_id).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "notes_quick_create_for_entity")
                    .with_context("household_id", household_id.to_string())
            })?;
            quick_create_note_for_entity(
                &pool,
                &household_id,
                entity_type,
                &entity_id,
                &category_id,
                &text,
                color.as_deref(),
            )
            .await
        }
    })
    .await
}
