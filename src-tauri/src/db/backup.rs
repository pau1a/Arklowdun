use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use fs2::available_space;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::task;
use ts_rs::TS;

use crate::{attachments, db::manifest, AppError, AppResult};

use super::manifest::BackupManifest;

const DB_FILE_NAME: &str = "arklowdun.sqlite3";
const BACKUP_DIR_NAME: &str = "backups";
const PARTIAL_SUFFIX: &str = ".partial";
const REQUIRED_FREE_MULTIPLIER: f64 = 1.2;
const DEFAULT_MAX_COUNT: usize = 5;
const HARD_MAX_COUNT: usize = 20;
const DEFAULT_MAX_BYTES: u64 = 2_000_000_000;
const HARD_MAX_BYTES: u64 = 20_000_000_000;
const MIN_RETENTION_BYTES: u64 = 50_000_000;
const LIST_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BackupEntry {
    pub directory: String,
    pub sqlite_path: String,
    pub manifest_path: String,
    pub manifest: BackupManifest,
    #[ts(type = "number")]
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BackupOverview {
    #[ts(type = "number")]
    pub available_bytes: u64,
    #[ts(type = "number")]
    pub db_size_bytes: u64,
    #[ts(type = "number")]
    pub required_free_bytes: u64,
    #[ts(type = "number")]
    pub retention_max_count: usize,
    #[ts(type = "number")]
    pub retention_max_bytes: u64,
    pub backups: Vec<BackupEntry>,
}

struct RetentionConfig {
    max_count: usize,
    max_bytes: u64,
}

impl RetentionConfig {
    fn load() -> Self {
        let max_count = env::var("ARK_BACKUP_MAX_COUNT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .map(|value| value.min(HARD_MAX_COUNT))
            .unwrap_or(DEFAULT_MAX_COUNT);

        let max_bytes = env::var("ARK_BACKUP_MAX_BYTES")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .map(|value| value.clamp(MIN_RETENTION_BYTES, HARD_MAX_BYTES))
            .unwrap_or(DEFAULT_MAX_BYTES);

        Self {
            max_count,
            max_bytes,
        }
    }
}

struct BackupRecord {
    directory: PathBuf,
    sqlite_path: PathBuf,
    manifest_path: PathBuf,
    manifest: BackupManifest,
    total_size_bytes: u64,
    created_at: DateTime<Utc>,
}

impl BackupRecord {
    fn into_entry(self) -> BackupEntry {
        BackupEntry {
            directory: self.directory.to_string_lossy().into_owned(),
            sqlite_path: self.sqlite_path.to_string_lossy().into_owned(),
            manifest_path: self.manifest_path.to_string_lossy().into_owned(),
            manifest: self.manifest,
            total_size_bytes: self.total_size_bytes,
        }
    }
}

pub async fn overview(_pool: &SqlitePool, db_path: &Path) -> AppResult<BackupOverview> {
    let db_path = db_path.to_path_buf();
    let retention = RetentionConfig::load();
    task::spawn_blocking(move || overview_sync(&db_path, &retention))
        .await
        .map_err(|err| {
            AppError::new("DB_BACKUP/TASK", "Backup overview task panicked")
                .with_context("error", err.to_string())
        })??
}

pub async fn create_backup(pool: &SqlitePool, db_path: &Path) -> AppResult<BackupEntry> {
    let schema_hash = manifest::schema_hash(pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "schema_hash"))?;
    let db_path = db_path.to_path_buf();
    let retention = RetentionConfig::load();
    let schema = schema_hash.clone();
    task::spawn_blocking(move || create_backup_sync(&db_path, &schema, &retention))
        .await
        .map_err(|err| {
            AppError::new("DB_BACKUP/TASK", "Backup task panicked")
                .with_context("error", err.to_string())
        })??
}

pub fn reveal_backup_root(db_path: &Path) -> AppResult<()> {
    let root = backup_root(db_path)?;
    fs::create_dir_all(&root).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "ensure_backups_dir")
            .with_context("path", root.display().to_string())
    })?;
    attachments::reveal_with_os(&root)
}

pub fn reveal_backup(db_path: &Path, sqlite_path: &Path) -> AppResult<()> {
    let root = backup_root(db_path)?;
    let canonical = fs::canonicalize(sqlite_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "canonicalize_backup")
            .with_context("path", sqlite_path.display().to_string())
    })?;
    if !canonical.starts_with(&root) {
        return Err(AppError::new(
            "DB_BACKUP/INVALID_PATH",
            "Path is outside the backups directory",
        )
        .with_context("path", canonical.display().to_string()));
    }
    attachments::reveal_with_os(&canonical)
}

fn overview_sync(db_path: &Path, retention: &RetentionConfig) -> AppResult<BackupOverview> {
    let root = backup_root(db_path)?;
    let db_size = fs::metadata(db_path).map(|meta| meta.len()).unwrap_or(0);
    let journal_bytes = journal_and_wal_bytes(db_path);
    let required = required_free_bytes(db_size.saturating_add(journal_bytes));
    let available = free_disk_space(&root)?;
    let mut records = collect_backups(&root)?;
    records.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    records.reverse();
    let entries = records
        .into_iter()
        .take(LIST_LIMIT)
        .map(BackupRecord::into_entry)
        .collect();

    Ok(BackupOverview {
        available_bytes: available,
        db_size_bytes: db_size,
        required_free_bytes: required,
        retention_max_count: retention.max_count,
        retention_max_bytes: retention.max_bytes,
        backups: entries,
    })
}

fn create_backup_sync(
    db_path: &Path,
    schema_hash: &str,
    retention: &RetentionConfig,
) -> AppResult<BackupEntry> {
    let root = backup_root(db_path)?;
    fs::create_dir_all(&root).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_backups_dir")
            .with_context("path", root.display().to_string())
    })?;

    let db_meta = fs::metadata(db_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "db_metadata")
            .with_context("path", db_path.display().to_string())
    })?;
    let db_size = db_meta.len();
    let journal_bytes = journal_and_wal_bytes(db_path);
    let required = required_free_bytes(db_size.saturating_add(journal_bytes));
    let available = free_disk_space(&root)?;
    if available < required {
        return Err(AppError::new(
            "DB_BACKUP/LOW_DISK",
            format!("Not enough disk space (need ~{}).", format_bytes(required)),
        )
        .with_context("available_bytes", available.to_string())
        .with_context("required_bytes", required.to_string()));
    }

    let timestamp = Utc::now();
    let backup_dir = unique_backup_dir(&root, &timestamp)?;
    if let Err(err) = fs::create_dir_all(&backup_dir) {
        return Err(AppError::from(err)
            .with_context("operation", "create_backup_dir")
            .with_context("path", backup_dir.display().to_string()));
    }
    sync_dir(&root).ok();

    let partial = backup_dir.join(format!("{DB_FILE_NAME}{PARTIAL_SUFFIX}"));
    let final_path = backup_dir.join(DB_FILE_NAME);
    let result = (|| -> AppResult<BackupRecord> {
        run_sqlite_backup(db_path, &partial)?;
        fs::rename(&partial, &final_path).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "finalize_backup")
                .with_context("from", partial.display().to_string())
                .with_context("to", final_path.display().to_string())
        })?;
        sync_dir(&backup_dir).ok();
        let file = fs::File::open(&final_path).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "open_backup_file")
                .with_context("path", final_path.display().to_string())
        })?;
        file.sync_all().ok();

        let sha = manifest::file_sha256(&final_path)
            .map_err(|err| AppError::from(err).with_context("operation", "hash_backup"))?;
        let size = fs::metadata(&final_path)
            .map(|meta| meta.len())
            .unwrap_or(db_size);
        let manifest = BackupManifest::new(env!("CARGO_PKG_VERSION"), schema_hash, size, sha);
        let manifest_path = backup_dir.join(manifest::MANIFEST_FILE_NAME);
        let payload = serde_json::to_vec_pretty(&manifest)
            .map_err(|err| AppError::from(err).with_context("operation", "serialize_manifest"))?;
        crate::db::write_atomic(&manifest_path, &payload).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "write_manifest")
                .with_context("path", manifest_path.display().to_string())
        })?;
        sync_dir(&backup_dir).ok();

        let record = load_record(&backup_dir, manifest)?;
        Ok(record)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&backup_dir);
    }

    let record = result?;
    apply_retention(&root, retention)?;
    Ok(record.into_entry())
}

fn backup_root(db_path: &Path) -> AppResult<PathBuf> {
    let parent = db_path.parent().ok_or_else(|| {
        AppError::new(
            "DB_BACKUP/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", db_path.display().to_string())
    })?;
    Ok(parent.join(BACKUP_DIR_NAME))
}

fn required_free_bytes(db_size: u64) -> u64 {
    if db_size == 0 {
        return (100_000_000_f64) as u64;
    }
    ((db_size as f64 * REQUIRED_FREE_MULTIPLIER).ceil()) as u64
}

fn free_disk_space(path: &Path) -> AppResult<u64> {
    if let Ok(fake) = env::var("ARK_BACKUP_FAKE_FREE_BYTES") {
        if let Ok(value) = fake.parse::<u64>() {
            return Ok(value);
        }
    }

    let mut owned: Option<PathBuf> = None;
    let target = if path.exists() {
        path
    } else if let Some(parent) = path.parent() {
        owned = Some(parent.to_path_buf());
        owned.as_ref().unwrap()
    } else {
        owned = Some(env::current_dir().unwrap_or_else(|_| PathBuf::from("/")));
        owned.as_ref().unwrap()
    };

    available_space(target).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "available_space")
            .with_context("path", target.display().to_string())
    })
}

fn journal_and_wal_bytes(db_path: &Path) -> u64 {
    const SUFFIXES: [&str; 3] = ["-wal", "-shm", "-journal"];

    SUFFIXES
        .iter()
        .map(|suffix| {
            let mut candidate = OsString::from(db_path.as_os_str());
            candidate.push(suffix);
            fs::metadata(Path::new(&candidate))
                .map(|meta| meta.len())
                .unwrap_or(0)
        })
        .sum()
}

fn unique_backup_dir(root: &Path, timestamp: &DateTime<Utc>) -> AppResult<PathBuf> {
    let base = timestamp.format("%Y%m%d-%H%M%S").to_string();
    for suffix in 0..100 {
        let candidate = if suffix == 0 {
            root.join(&base)
        } else {
            root.join(format!("{base}-{suffix:02}"))
        };
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::new(
        "DB_BACKUP/NAME_COLLISION",
        "Unable to allocate backup directory",
    ))
}

fn run_sqlite_backup(src: &Path, dest: &Path) -> AppResult<()> {
    let src_flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI;
    let src_conn = Connection::open_with_flags(src, src_flags).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "open_source_db")
            .with_context("path", src.display().to_string())
    })?;
    let dest_conn = Connection::open(dest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_backup_db")
            .with_context("path", dest.display().to_string())
    })?;

    let mut backup = Backup::new(&dest_conn, "main", &src_conn, "main")
        .map_err(|err| AppError::from(err).with_context("operation", "backup_init"))?;
    backup
        .step(-1)
        .map_err(|err| AppError::from(err).with_context("operation", "backup_step"))?;
    backup
        .finish()
        .map_err(|err| AppError::from(err).with_context("operation", "backup_finish"))?;

    dest_conn
        .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .ok();
    dest_conn.execute_batch("PRAGMA journal_mode=DELETE;").ok();

    dest_conn
        .close()
        .map_err(|(_, err)| AppError::from(err).with_context("operation", "close_backup_db"))?;
    src_conn
        .close()
        .map_err(|(_, err)| AppError::from(err).with_context("operation", "close_source_db"))?;

    Ok(())
}

fn collect_backups(root: &Path) -> AppResult<Vec<BackupRecord>> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "read_backups_dir")
            .with_context("path", root.display().to_string())
    })? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                tracing::warn!(target: "arklowdun", error = %err, "skip_invalid_backup_entry");
                continue;
            }
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join(manifest::MANIFEST_FILE_NAME);
        let manifest = match manifest::read_manifest(&manifest_path) {
            Ok(manifest) => manifest,
            Err(err) => {
                tracing::warn!(
                    target: "arklowdun",
                    error = %err,
                    path = %manifest_path.display(),
                    "skip_backup_missing_manifest"
                );
                continue;
            }
        };

        match load_record(&path, manifest) {
            Ok(record) => out.push(record),
            Err(err) => {
                tracing::warn!(
                    target: "arklowdun",
                    error = %err,
                    path = %path.display(),
                    "skip_backup_invalid"
                );
            }
        }
    }

    Ok(out)
}

fn load_record(dir: &Path, manifest: BackupManifest) -> AppResult<BackupRecord> {
    let sqlite_path = dir.join(DB_FILE_NAME);
    let manifest_path = dir.join(manifest::MANIFEST_FILE_NAME);
    if !sqlite_path.exists() {
        return Err(
            AppError::new("DB_BACKUP/MISSING_DB", "Backup missing database file")
                .with_context("path", sqlite_path.display().to_string()),
        );
    }
    if !manifest_path.exists() {
        return Err(
            AppError::new("DB_BACKUP/MISSING_MANIFEST", "Backup missing manifest")
                .with_context("path", manifest_path.display().to_string()),
        );
    }

    let total_size = dir_size(dir)?;
    let created_at = parse_created_at(&manifest).unwrap_or_else(|| fallback_created_at(dir));

    Ok(BackupRecord {
        directory: dir.to_path_buf(),
        sqlite_path,
        manifest_path,
        manifest,
        total_size_bytes: total_size,
        created_at,
    })
}

fn dir_size(path: &Path) -> AppResult<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "dir_size")
            .with_context("path", path.display().to_string())
    })? {
        let entry =
            entry.map_err(|err| AppError::from(err).with_context("operation", "dir_size_entry"))?;
        let meta = entry
            .metadata()
            .map_err(|err| AppError::from(err).with_context("operation", "dir_size_metadata"))?;
        if meta.is_dir() {
            total += dir_size(&entry.path())?;
        } else {
            total += meta.len();
        }
    }
    Ok(total)
}

fn parse_created_at(manifest: &BackupManifest) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&manifest.created_at)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

fn fallback_created_at(path: &Path) -> DateTime<Utc> {
    let meta = fs::metadata(path);
    if let Ok(meta) = meta {
        if let Ok(modified) = meta.modified() {
            return DateTime::<Utc>::from(modified);
        }
    }
    DateTime::<Utc>::from(SystemTime::UNIX_EPOCH)
}

fn apply_retention(root: &Path, retention: &RetentionConfig) -> AppResult<()> {
    let mut records = collect_backups(root)?;
    if records.is_empty() {
        return Ok(());
    }
    records.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let mut total: u64 = records.iter().map(|r| r.total_size_bytes).sum();

    while records.len() > retention.max_count || total > retention.max_bytes {
        let record = records.remove(0);
        let size = record.total_size_bytes;
        if let Err(err) = fs::remove_dir_all(&record.directory) {
            tracing::warn!(
                target: "arklowdun",
                error = %err,
                path = %record.directory.display(),
                "failed_to_remove_old_backup"
            );
            continue;
        }
        total = total.saturating_sub(size);
    }

    Ok(())
}

fn sync_dir(path: &Path) -> io::Result<()> {
    fs::File::open(path)?.sync_all()
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 MB".to_string();
    }
    let mb = (bytes as f64) / 1_000_000.0;
    if mb < 1.0 {
        "1 MB".to_string()
    } else {
        format!("{:.0} MB", mb.ceil())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn retention_config_defaults() {
        let cfg = RetentionConfig::load();
        assert_eq!(cfg.max_count, DEFAULT_MAX_COUNT);
        assert_eq!(cfg.max_bytes, DEFAULT_MAX_BYTES);
    }

    #[tokio::test]
    async fn overview_handles_missing_dir() {
        let tmp = tempdir().unwrap();
        let db_path = tmp.path().join(DB_FILE_NAME);
        fs::write(&db_path, b"test").unwrap();
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let info = overview(&pool, &db_path).await.unwrap();
        assert_eq!(info.db_size_bytes, b"test".len() as u64);
        assert!(info.available_bytes > 0);
    }
}
