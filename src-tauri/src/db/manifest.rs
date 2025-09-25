use std::{borrow::Cow, fs::File, io::Read, path::Path};

use anyhow::{Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{pool::PoolConnection, Row, Sqlite, SqlitePool};
use ts_rs::TS;

pub const MANIFEST_FILE_NAME: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BackupManifest {
    pub app_version: String,
    pub schema_hash: String,
    #[ts(type = "number")]
    pub db_size_bytes: u64,
    pub created_at: String,
    pub sha256: String,
}

impl BackupManifest {
    pub fn new(
        app_version: impl Into<String>,
        schema_hash: impl Into<String>,
        db_size_bytes: u64,
        sha256: impl Into<String>,
    ) -> Self {
        Self {
            app_version: app_version.into(),
            schema_hash: schema_hash.into(),
            db_size_bytes,
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            sha256: sha256.into(),
        }
    }
}

pub async fn schema_hash(pool: &SqlitePool) -> Result<String> {
    let mut conn = pool
        .acquire()
        .await
        .context("acquire connection for schema hash")?;
    schema_hash_from_conn(&mut conn).await
}

pub async fn schema_hash_from_conn(conn: &mut PoolConnection<Sqlite>) -> Result<String> {
    let rows = sqlx::query(
        "SELECT type, name, tbl_name, sql FROM sqlite_master\n         WHERE type IN ('table','index','trigger','view')\n  ORDER BY type, name",
    )
    .fetch_all(conn.as_mut())
    .await?;

    let mut hasher = Sha256::new();
    for row in rows {
        let ty: String = row.try_get("type")?;
        let name: String = row.try_get("name")?;
        let tbl: String = row.try_get("tbl_name")?;
        let sql: Option<String> = row.try_get("sql").ok();

        hasher.update(ty.as_bytes());
        hasher.update([0]);
        hasher.update(name.as_bytes());
        hasher.update([0]);
        hasher.update(tbl.as_bytes());
        hasher.update([0]);
        if let Some(sql) = sql {
            hasher.update(sql.as_bytes());
        }
        hasher.update([0]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

pub fn file_sha256(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("open file for hashing: {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 8192];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

const UP_SUFFIX: &str = ".up.sql";
const DOWN_SUFFIX: &str = ".down.sql";

pub fn normalize_schema_version(version: &str) -> Cow<'_, str> {
    let lower = version.to_ascii_lowercase();
    if lower.ends_with(UP_SUFFIX) {
        Cow::Owned(version[..version.len() - UP_SUFFIX.len()].to_string())
    } else if lower.ends_with(DOWN_SUFFIX) {
        Cow::Owned(version[..version.len() - DOWN_SUFFIX.len()].to_string())
    } else {
        Cow::Borrowed(version)
    }
}

pub fn normalize_schema_version_owned(version: String) -> String {
    match normalize_schema_version(&version) {
        Cow::Borrowed(_) => version,
        Cow::Owned(normalized) => normalized,
    }
}

pub fn read_manifest(path: &Path) -> Result<BackupManifest> {
    let mut file =
        File::open(path).with_context(|| format!("open manifest file: {}", path.display()))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    let manifest: BackupManifest = serde_json::from_slice(&buf)
        .with_context(|| format!("parse manifest file: {}", path.display()))?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn schema_hash_is_stable() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect in-memory");
        sqlx::query("CREATE TABLE example(id INTEGER PRIMARY KEY, name TEXT);")
            .execute(&pool)
            .await
            .unwrap();

        let first = schema_hash(&pool).await.unwrap();
        let second = schema_hash(&pool).await.unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn file_sha256_matches_manual_digest() {
        let mut tmp = NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut tmp, b"hello world").unwrap();
        let expected = format!("{:x}", Sha256::digest(b"hello world"));
        let actual = file_sha256(tmp.path()).unwrap();
        assert_eq!(expected, actual);
    }

    #[test]
    fn read_manifest_roundtrip() {
        let manifest = BackupManifest::new("1.2.3", "abc", 42, "def");
        let tmp = NamedTempFile::new().unwrap();
        serde_json::to_writer_pretty(tmp.as_file(), &manifest).unwrap();
        tmp.as_file().sync_all().unwrap();
        let loaded = read_manifest(tmp.path()).unwrap();
        assert_eq!(loaded.app_version, manifest.app_version);
        assert_eq!(loaded.schema_hash, manifest.schema_hash);
        assert_eq!(loaded.db_size_bytes, manifest.db_size_bytes);
        assert_eq!(loaded.sha256, manifest.sha256);
    }

    #[test]
    fn schema_version_normalization_strips_suffix() {
        let canonical = normalize_schema_version("20230101_add_table.up.sql");
        assert_eq!(canonical, "20230101_add_table");

        let canonical_down = normalize_schema_version("20230101_add_table.DOWN.SQL");
        assert_eq!(canonical_down, "20230101_add_table");

        let unchanged = normalize_schema_version("20230101_add_table");
        assert_eq!(unchanged, "20230101_add_table");
    }
}
