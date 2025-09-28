use std::path::Path;

use semver::Version;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;

use super::bundle::{ImportBundle, ImportBundleError};
use crate::db::manifest as db_manifest;

#[derive(Debug, Clone)]
pub struct ValidationContext<'a> {
    pub pool: &'a SqlitePool,
    pub target_root: &'a Path,
    pub minimum_app_version: &'a Version,
    pub available_space_override: Option<u64>,
}

impl<'a> ValidationContext<'a> {
    pub fn with_minimum_version(
        pool: &'a SqlitePool,
        target_root: &'a Path,
        minimum_app_version: &'a Version,
    ) -> Self {
        Self {
            pool,
            target_root,
            minimum_app_version,
            available_space_override: None,
        }
    }
}

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("schema version mismatch: live={live}, bundle={bundle}")]
    SchemaVersionMismatch { live: String, bundle: String },
    #[error("bundle app version {found} is older than minimum supported {minimum}")]
    AppVersionTooOld { minimum: String, found: String },
    #[error("bundle size {bundle_bytes} exceeds available disk space {available_bytes}")]
    InsufficientDisk {
        bundle_bytes: u64,
        available_bytes: u64,
    },
    #[error("data file hash mismatch at {path}: {reason}")]
    DataFileHashMismatch { path: String, reason: String },
    #[error("attachment hash mismatch at {path}: {reason}")]
    AttachmentHashMismatch { path: String, reason: String },
    #[error("attachments manifest hash mismatch at {path}: {reason}")]
    AttachmentsManifestHash { path: String, reason: String },
    #[error("bundle error: {0}")]
    Bundle(#[from] ImportBundleError),
    #[error("database error: {0}")]
    Database(String),
    #[error("invalid app version in manifest: {0}")]
    InvalidAppVersion(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ValidationReport {
    pub bundle_size_bytes: u64,
    pub data_files_verified: usize,
    pub attachments_verified: usize,
}

pub async fn validate_bundle(
    bundle: &ImportBundle,
    ctx: &ValidationContext<'_>,
) -> Result<ValidationReport, ValidationError> {
    validate_schema_version(bundle, ctx).await?;
    validate_app_version(bundle, ctx)?;
    let bundle_size = bundle.total_size_bytes();
    validate_disk_space(bundle_size, ctx)?;
    validate_hashes(bundle)?;

    Ok(ValidationReport {
        bundle_size_bytes: bundle_size,
        data_files_verified: bundle.data_files().len(),
        attachments_verified: bundle.attachments().len(),
    })
}

async fn validate_schema_version(
    bundle: &ImportBundle,
    ctx: &ValidationContext<'_>,
) -> Result<(), ValidationError> {
    let sql = "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1";
    let live: Option<String> = sqlx::query_scalar(sql)
        .fetch_optional(ctx.pool)
        .await
        .map_err(|err| ValidationError::Database(err.to_string()))?;

    let live_version = if let Some(v) = live {
        db_manifest::normalize_schema_version_owned(v)
    } else {
        db_manifest::normalize_schema_version_owned(
            db_manifest::schema_hash(ctx.pool)
                .await
                .map_err(|err| ValidationError::Database(err.to_string()))?,
        )
    };

    let bundle_version =
        db_manifest::normalize_schema_version_owned(bundle.manifest().schema_version.clone());
    if live_version != bundle_version {
        return Err(ValidationError::SchemaVersionMismatch {
            live: live_version,
            bundle: bundle_version,
        });
    }
    Ok(())
}

fn validate_app_version(
    bundle: &ImportBundle,
    ctx: &ValidationContext<'_>,
) -> Result<(), ValidationError> {
    let min = ctx.minimum_app_version;
    let manifest_version = Version::parse(&bundle.manifest().app_version)
        .map_err(|err| ValidationError::InvalidAppVersion(err.to_string()))?;
    if manifest_version < *min {
        return Err(ValidationError::AppVersionTooOld {
            minimum: min.to_string(),
            found: manifest_version.to_string(),
        });
    }
    Ok(())
}

fn validate_disk_space(size: u64, ctx: &ValidationContext<'_>) -> Result<(), ValidationError> {
    let available = if let Some(v) = ctx.available_space_override {
        v
    } else {
        fs2::available_space(ctx.target_root)
            .map_err(|err| ValidationError::Database(err.to_string()))?
    };
    if available < size {
        return Err(ValidationError::InsufficientDisk {
            bundle_bytes: size,
            available_bytes: available,
        });
    }
    Ok(())
}

fn validate_hashes(bundle: &ImportBundle) -> Result<(), ValidationError> {
    bundle
        .verify_attachments_manifest()
        .map_err(|err| match err {
            ImportBundleError::Hash { path, source } => ValidationError::AttachmentsManifestHash {
                path,
                reason: source.to_string(),
            },
            other => ValidationError::Bundle(other),
        })?;

    for data in bundle.data_files() {
        bundle
            .verify_data_file_hash(data)
            .map_err(|err| match err {
                ImportBundleError::Hash { source, .. } => ValidationError::DataFileHashMismatch {
                    path: data.path.display().to_string(),
                    reason: source.to_string(),
                },
                other => ValidationError::Bundle(other),
            })?;
    }

    for attachment in bundle.attachments() {
        bundle
            .verify_attachment_hash(attachment)
            .map_err(|err| match err {
                ImportBundleError::Hash { source, .. } => ValidationError::AttachmentHashMismatch {
                    path: attachment.relative_path.clone(),
                    reason: source.to_string(),
                },
                ImportBundleError::AttachmentMissing(path) => {
                    ValidationError::AttachmentHashMismatch {
                        path,
                        reason: "missing file".to_string(),
                    }
                }
                other => ValidationError::Bundle(other),
            })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::manifest::file_sha256;
    use crate::import::bundle::ImportBundle;
    use semver::Version;
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::TempDir;

    async fn setup_pool(schema_version: &str) -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite pool");
        sqlx::query(
            "CREATE TABLE schema_migrations (\n                version TEXT PRIMARY KEY,\n                applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)\n            )",
        )
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)")
            .bind(schema_version)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    struct BundlePaths {
        data_file: PathBuf,
        attachment_file: PathBuf,
    }

    fn write_bundle(root: &Path, schema_version: &str, app_version: &str) -> BundlePaths {
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::create_dir_all(root.join("attachments")).unwrap();

        let households_path = root.join("data/households.jsonl");
        std::fs::write(&households_path, "{\"id\":1}\n").unwrap();
        let households_sha = file_sha256(&households_path).unwrap();

        let attachment_path = root.join("attachments/doc.txt");
        std::fs::write(&attachment_path, b"hello world").unwrap();
        let attachment_sha = file_sha256(&attachment_path).unwrap();

        let attachments_manifest = root.join("attachments_manifest.txt");
        std::fs::write(
            &attachments_manifest,
            format!("doc.txt\t{}\n", attachment_sha),
        )
        .unwrap();
        let attachments_manifest_sha = file_sha256(&attachments_manifest).unwrap();

        let manifest = json!({
            "appVersion": app_version,
            "schemaVersion": schema_version,
            "createdAt": "2024-01-01T00:00:00Z",
            "tables": {
                "households": {"count": 1, "sha256": households_sha},
            },
            "attachments": {
                "totalCount": 1,
                "totalBytes": 11,
                "sha256Manifest": attachments_manifest_sha,
            }
        });
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let _ = attachments_manifest;

        BundlePaths {
            data_file: households_path,
            attachment_file: attachment_path,
        }
    }

    fn ctx<'a>(
        pool: &'a SqlitePool,
        root: &'a Path,
        min_version: &'a Version,
    ) -> ValidationContext<'a> {
        let mut ctx = ValidationContext::with_minimum_version(pool, root, min_version);
        ctx.available_space_override = Some(10_000_000);
        ctx
    }

    #[tokio::test]
    async fn validate_bundle_success() {
        let pool = setup_pool("20240101000000").await;
        let bundle_dir = TempDir::new().unwrap();
        write_bundle(bundle_dir.path(), "20240101000000", "1.0.0");
        let bundle = ImportBundle::load(bundle_dir.path()).unwrap();
        let min_version = Version::parse("0.5.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let mut ctx = ctx(&pool, target_dir.path(), &min_version);
        ctx.available_space_override = Some(bundle.total_size_bytes() + 1024);

        let report = validate_bundle(&bundle, &ctx).await.unwrap();
        assert_eq!(report.data_files_verified, 1);
        assert_eq!(report.attachments_verified, 1);
        assert!(report.bundle_size_bytes >= bundle.total_size_bytes());
    }

    #[tokio::test]
    async fn schema_version_mismatch() {
        let pool = setup_pool("live_version").await;
        let dir = TempDir::new().unwrap();
        write_bundle(dir.path(), "bundle_version", "1.0.0");
        let bundle = ImportBundle::load(dir.path()).unwrap();
        let min_version = Version::parse("0.1.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let ctx = ctx(&pool, target_dir.path(), &min_version);

        let err = validate_bundle(&bundle, &ctx).await.unwrap_err();
        matches!(err, ValidationError::SchemaVersionMismatch { .. })
            .then_some(())
            .unwrap();
    }

    #[tokio::test]
    async fn schema_version_suffix_is_ignored() {
        let canonical = "20240101000000";
        let pool = setup_pool(canonical).await;
        let dir = TempDir::new().unwrap();
        write_bundle(dir.path(), &format!("{canonical}.up.sql"), "1.0.0");
        let bundle = ImportBundle::load(dir.path()).unwrap();
        let min_version = Version::parse("0.1.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let ctx = ctx(&pool, target_dir.path(), &min_version);

        validate_bundle(&bundle, &ctx).await.unwrap();
    }

    #[tokio::test]
    async fn app_version_too_old() {
        let pool = setup_pool("20240101000000").await;
        let dir = TempDir::new().unwrap();
        write_bundle(dir.path(), "20240101000000", "0.1.0");
        let bundle = ImportBundle::load(dir.path()).unwrap();
        let min_version = Version::parse("1.0.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let ctx = ctx(&pool, target_dir.path(), &min_version);

        let err = validate_bundle(&bundle, &ctx).await.unwrap_err();
        matches!(err, ValidationError::AppVersionTooOld { .. })
            .then_some(())
            .unwrap();
    }

    #[tokio::test]
    async fn insufficient_disk_space() {
        let pool = setup_pool("20240101000000").await;
        let dir = TempDir::new().unwrap();
        write_bundle(dir.path(), "20240101000000", "1.0.0");
        let bundle = ImportBundle::load(dir.path()).unwrap();
        let min_version = Version::parse("0.1.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let mut ctx = ctx(&pool, target_dir.path(), &min_version);
        ctx.available_space_override = Some(1);

        let err = validate_bundle(&bundle, &ctx).await.unwrap_err();
        matches!(err, ValidationError::InsufficientDisk { .. })
            .then_some(())
            .unwrap();
    }

    #[tokio::test]
    async fn data_hash_mismatch_detected() {
        let pool = setup_pool("20240101000000").await;
        let dir = TempDir::new().unwrap();
        let paths = write_bundle(dir.path(), "20240101000000", "1.0.0");
        std::fs::write(&paths.data_file, "tampered\n").unwrap();
        let bundle = ImportBundle::load(dir.path()).unwrap();
        let min_version = Version::parse("0.1.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let ctx = ctx(&pool, target_dir.path(), &min_version);

        let err = validate_bundle(&bundle, &ctx).await.unwrap_err();
        matches!(err, ValidationError::DataFileHashMismatch { .. })
            .then_some(())
            .unwrap();
    }

    #[tokio::test]
    async fn attachment_hash_mismatch_detected() {
        let pool = setup_pool("20240101000000").await;
        let dir = TempDir::new().unwrap();
        let paths = write_bundle(dir.path(), "20240101000000", "1.0.0");
        std::fs::write(&paths.attachment_file, b"different").unwrap();
        let bundle = ImportBundle::load(dir.path()).unwrap();
        let min_version = Version::parse("0.1.0").unwrap();
        let target_dir = TempDir::new().unwrap();
        let ctx = ctx(&pool, target_dir.path(), &min_version);

        let err = validate_bundle(&bundle, &ctx).await.unwrap_err();
        matches!(err, ValidationError::AttachmentHashMismatch { .. })
            .then_some(())
            .unwrap();
    }
}
