use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{SecondsFormat, Utc};
use infer::Infer;
use mime_guess::MimeGuess;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tokio::sync::mpsc::Sender;
use walkdir::WalkDir;

use crate::attachment_category::AttachmentCategory;
use crate::vault::Vault;
use crate::{AppError, AppResult};

const PROGRESS_BATCH: u64 = 25;
const MAX_DEPTH: usize = 16;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebuildMode {
    Full,
    Incremental,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum IndexerState {
    Idle,
    Building,
    Cancelling,
    Error,
}

impl Default for IndexerState {
    fn default() -> Self {
        IndexerState::Idle
    }
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct IndexProgress {
    pub scanned: u64,
    pub updated: u64,
    pub skipped: u64,
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct IndexSummary {
    pub total: u64,
    pub updated: u64,
    pub duration_ms: u64,
}

struct ExistingRow {
    file_id: String,
    size_bytes: Option<i64>,
    modified_at: Option<i64>,
}

pub struct FilesIndexer {
    pool: SqlitePool,
    vault: Arc<Vault>,
    cancel_token: Arc<AtomicBool>,
    state: Arc<Mutex<HashMap<String, IndexerState>>>,
}

impl FilesIndexer {
    pub fn new(pool: SqlitePool, vault: Arc<Vault>) -> Self {
        Self {
            pool,
            vault,
            cancel_token: Arc::new(AtomicBool::new(false)),
            state: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn rebuild(
        &self,
        household_id: &str,
        mode: RebuildMode,
        progress_tx: Sender<IndexProgress>,
    ) -> AppResult<IndexSummary> {
        self.cancel_token.store(false, Ordering::SeqCst);
        self.set_state(household_id, IndexerState::Building);
        let result = self
            .rebuild_internal(household_id.to_string(), mode, progress_tx)
            .await;
        match result {
            Ok(summary) => {
                self.set_state(household_id, IndexerState::Idle);
                Ok(summary)
            }
            Err(err) => {
                self.set_state(household_id, IndexerState::Error);
                Err(err)
            }
        }
    }

    fn set_state(&self, household_id: &str, state: IndexerState) {
        let mut guard = self.state.lock().expect("indexer state lock");
        if matches!(state, IndexerState::Idle) {
            guard.remove(household_id);
        } else {
            guard.insert(household_id.to_string(), state);
        }
    }

    pub fn current_state(&self, household_id: &str) -> IndexerState {
        let guard = self.state.lock().expect("indexer state lock");
        guard
            .get(household_id)
            .copied()
            .unwrap_or(IndexerState::Idle)
    }

    async fn rebuild_internal(
        &self,
        household: String,
        mode: RebuildMode,
        progress_tx: Sender<IndexProgress>,
    ) -> AppResult<IndexSummary> {
        let start = std::time::Instant::now();
        let mut tx = progress_tx;

        let pool = self.pool.clone();
        let vault = self.vault.clone();
        let cancel = self.cancel_token.clone();

        let mut conn = pool.acquire().await?;
        let mut existing: HashMap<(String, String), ExistingRow> = HashMap::new();
        let rows = sqlx::query(
            "SELECT file_id, category, filename, size_bytes, modified_at_utc\n             FROM files_index WHERE household_id=?1",
        )
        .bind(&household)
        .fetch_all(conn.as_mut())
        .await?;
        for row in rows {
            let file_id: String = row.try_get("file_id")?;
            let category: String = row.try_get("category")?;
            let filename: String = row.try_get("filename")?;
            let size_bytes: Option<i64> = row.try_get("size_bytes")?;
            let modified_at: Option<i64> = row.try_get("modified_at_utc")?;
            existing.insert(
                (category, filename),
                ExistingRow {
                    file_id,
                    size_bytes,
                    modified_at,
                },
            );
        }
        drop(conn);

        let mut scanned = 0_u64;
        let mut updated = 0_u64;
        let mut skipped = 0_u64;
        let mut batch_progress = IndexProgress::default();
        let mut seen: HashSet<(String, String)> = HashSet::new();
        let mut ordinal: i64 = 0;
        let mut max_modified: Option<i64> = None;

        let base = vault.base().join(&household);
        if !base.exists() {
            tracing::warn!(
                target: "arklowdun",
                event = "files_index_rebuild_missing_household",
                household_id = %household,
                "Household attachments directory does not exist"
            );
        }

        let infer_engine = Infer::new();

        for category in AttachmentCategory::iter() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let category_slug = category.as_str().to_string();
            let category_dir = base.join(category_slug.as_str());
            if !category_dir.exists() {
                continue;
            }
            for entry in WalkDir::new(&category_dir)
                .follow_links(false)
                .min_depth(1)
                .max_depth(MAX_DEPTH)
            {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(err) => {
                        tracing::warn!(
                            target: "arklowdun",
                            event = "files_index_walk_error",
                            household_id = %household,
                            category = %category_slug,
                            error = %err,
                            "Skipping entry due to walkdir error"
                        );
                        continue;
                    }
                };
                let file_type = entry.file_type();
                if !file_type.is_file() {
                    continue;
                }
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with('.') {
                        continue;
                    }
                }
                let depth = entry.depth();
                if depth > MAX_DEPTH {
                    continue;
                }

                let path = entry.path().to_path_buf();
                let filename = match relative_filename(&category_dir, &path) {
                    Some(name) => name,
                    None => continue,
                };

                scanned += 1;
                batch_progress.scanned += 1;

                let metadata = match std::fs::metadata(&path) {
                    Ok(meta) => meta,
                    Err(err) => {
                        tracing::warn!(
                            target: "arklowdun",
                            event = "files_index_metadata_error",
                            household_id = %household,
                            category = %category_slug,
                            error = %err,
                            path = %path.display(),
                            "Failed to read metadata for attachment"
                        );
                        skipped += 1;
                        batch_progress.skipped += 1;
                        maybe_emit(&mut tx, &mut batch_progress).await?;
                        continue;
                    }
                };

                if metadata.is_dir() {
                    continue;
                }

                let size = metadata.len() as i64;
                let modified_at = metadata
                    .modified()
                    .ok()
                    .and_then(|mtime| to_epoch_seconds(mtime));

                let key = (category_slug.clone(), filename.clone());
                let unchanged = if let (RebuildMode::Incremental, Some(existing_row)) =
                    (mode, existing.get(&key))
                {
                    existing_row.size_bytes == Some(size) && existing_row.modified_at == modified_at
                } else {
                    false
                };

                if unchanged {
                    skipped += 1;
                    batch_progress.skipped += 1;
                    seen.insert(key.clone());
                    maybe_emit(&mut tx, &mut batch_progress).await?;
                    continue;
                }

                let file_id = if let Some(existing_row) = existing.get(&key) {
                    existing_row.file_id.clone()
                } else {
                    derive_file_id(&key)
                };

                let mime = detect_mime(&infer_engine, &path);

                let sha256: Option<String> = None;
                let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

                let mut conn = pool.acquire().await?;
                sqlx::query(
                    "INSERT INTO files_index\n                     (household_id, file_id, category, filename, updated_at_utc, ordinal, score_hint, size_bytes, mime, modified_at_utc, sha256)\n                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10)\n                     ON CONFLICT(household_id, category, filename)\n                     DO UPDATE SET\n                       file_id=excluded.file_id,\n                       updated_at_utc=excluded.updated_at_utc,\n                       ordinal=excluded.ordinal,\n                       score_hint=excluded.score_hint,\n                       size_bytes=excluded.size_bytes,\n                       mime=excluded.mime,\n                       modified_at_utc=excluded.modified_at_utc,\n                       sha256=excluded.sha256"
                )
                .bind(&household)
                .bind(&file_id)
                .bind(&key.0)
                .bind(&key.1)
                .bind(&now)
                .bind(ordinal)
                .bind(size)
                .bind(&mime)
                .bind(modified_at)
                .bind(&sha256)
                .execute(conn.as_mut())
                .await?;
                drop(conn);

                ordinal += 1;
                updated += 1;
                batch_progress.updated += 1;
                seen.insert(key.clone());
                if let Some(modified) = modified_at {
                    max_modified =
                        Some(max_modified.map_or(modified, |existing| existing.max(modified)));
                }
                maybe_emit(&mut tx, &mut batch_progress).await?;
            }
        }

        // Delete orphans
        let mut conn = pool.acquire().await?;
        for ((category, filename), existing_row) in existing.into_iter() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            if !seen.contains(&(category.clone(), filename.clone())) {
                sqlx::query("DELETE FROM files_index WHERE household_id=?1 AND file_id=?2")
                    .bind(&household)
                    .bind(&existing_row.file_id)
                    .execute(conn.as_mut())
                    .await?;
            }
        }

        let total = seen.len() as u64;
        let duration_ms = start.elapsed().as_millis() as u64;
        let max_updated_iso = max_modified
            .and_then(|value| Some(iso_from_epoch(value)))
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

        let last_built = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        sqlx::query(
            "INSERT INTO files_index_meta (household_id, last_built_at_utc, source_row_count, source_max_updated_utc, version)\n             VALUES (?1, ?2, ?3, ?4, ?5)\n             ON CONFLICT(household_id) DO UPDATE SET\n               last_built_at_utc=excluded.last_built_at_utc,\n               source_row_count=excluded.source_row_count,\n               source_max_updated_utc=excluded.source_max_updated_utc,\n               version=excluded.version",
        )
        .bind(&household)
        .bind(&last_built)
        .bind(total as i64)
        .bind(&max_updated_iso)
        .bind(crate::FILES_INDEX_VERSION)
        .execute(conn.as_mut())
        .await?;
        drop(conn);

        if cancel.load(Ordering::SeqCst) {
            tracing::info!(
                target: "arklowdun",
                event = "files_index_cancelled",
                household_id = %household,
                scanned,
                updated,
                skipped,
                "Indexer cancelled"
            );
        } else {
            tracing::info!(
                target: "arklowdun",
                event = "files_index_completed",
                household_id = %household,
                scanned,
                updated,
                skipped,
                total,
                duration_ms,
                "Indexer completed"
            );
        }

        let summary = IndexSummary {
            total,
            updated,
            duration_ms,
        };

        let _ = tx
            .send(IndexProgress {
                scanned,
                updated,
                skipped,
            })
            .await;

        Ok(summary)
    }

    pub async fn cancel(&self, household_id: &str) {
        self.cancel_token.store(true, Ordering::SeqCst);
        self.set_state(household_id, IndexerState::Cancelling);
    }
}

fn relative_filename(base: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(base).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        use std::path::Component;
        match component {
            Component::Normal(os) => {
                let part = os.to_string_lossy().into_owned();
                if part.starts_with('.') {
                    return None;
                }
                parts.push(part);
            }
            Component::CurDir => continue,
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn to_epoch_seconds(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|dur| dur.as_secs() as i64)
}

fn iso_from_epoch(epoch: i64) -> String {
    let dt = UNIX_EPOCH + Duration::from_secs(epoch as u64);
    let datetime: chrono::DateTime<Utc> = dt.into();
    datetime.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn detect_mime(infer_engine: &Infer, path: &PathBuf) -> String {
    if let Ok(Some(kind)) = infer_engine.get_from_path(path) {
        return kind.mime_type().to_string();
    }
    MimeGuess::from_path(path)
        .first()
        .map(|m| m.essence_str().to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

fn derive_file_id(key: &(String, String)) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.0.as_bytes());
    hasher.update(b"/");
    hasher.update(key.1.as_bytes());
    format!("{:x}", hasher.finalize())
}

async fn maybe_emit(tx: &mut Sender<IndexProgress>, batch: &mut IndexProgress) -> AppResult<()> {
    if batch.scanned + batch.updated + batch.skipped >= PROGRESS_BATCH {
        let snapshot = batch.clone();
        tx.send(snapshot).await.map_err(|err| {
            AppError::new(
                "INDEX_PROGRESS_CHANNEL_CLOSED",
                "Progress receiver dropped.",
            )
            .with_context("error", err.to_string())
        })?;
        *batch = IndexProgress::default();
    }
    Ok(())
}
