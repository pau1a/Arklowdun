use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{Context, Error as AnyError};
use thiserror::Error;

use crate::export::manifest::{file_sha256, ExportManifest};

#[derive(Debug, Error)]
pub enum ImportBundleError {
    #[error("manifest.json not found in bundle")]
    ManifestMissing,
    #[error("failed to read manifest.json: {0}")]
    ManifestRead(String),
    #[error("failed to parse manifest.json: {0}")]
    ManifestParse(String),
    #[error("bundle is missing data directory")]
    DataDirMissing,
    #[error("bundle is missing attachments directory")]
    AttachmentsDirMissing,
    #[error("bundle is missing attachments manifest")]
    AttachmentsManifestMissing,
    #[error("invalid attachments manifest: {0}")]
    AttachmentsManifestInvalid(String),
    #[error("bundle data file missing: {0}")]
    DataFileMissing(String),
    #[error("bundle attachment missing: {0}")]
    AttachmentMissing(String),
    #[error("failed to hash file {path}: {source}")]
    Hash {
        path: String,
        #[source]
        source: AnyError,
    },
    #[error("failed to enumerate bundle: {source}")]
    Walk {
        #[source]
        source: AnyError,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentEntry {
    pub relative_path: String,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct DataFileEntry {
    pub logical_name: String,
    pub path: PathBuf,
    pub sha256: String,
    pub count: u64,
}

#[derive(Debug, Clone)]
pub struct ImportBundle {
    root: PathBuf,
    manifest_path: PathBuf,
    data_dir: PathBuf,
    attachments_dir: PathBuf,
    attachments_manifest_path: PathBuf,
    manifest: ExportManifest,
    attachments: Vec<AttachmentEntry>,
    data_files: Vec<DataFileEntry>,
    total_size_bytes: u64,
}

impl ImportBundle {
    pub fn load(root: impl AsRef<Path>) -> Result<Self, ImportBundleError> {
        let root = root.as_ref();
        let manifest_path = root.join("manifest.json");
        if !manifest_path.is_file() {
            return Err(ImportBundleError::ManifestMissing);
        }

        let manifest_text = fs::read_to_string(&manifest_path)
            .map_err(|err| ImportBundleError::ManifestRead(err.to_string()))?;
        let manifest: ExportManifest = serde_json::from_str(&manifest_text)
            .map_err(|err| ImportBundleError::ManifestParse(err.to_string()))?;

        let data_dir = root.join("data");
        if !data_dir.is_dir() {
            return Err(ImportBundleError::DataDirMissing);
        }
        let attachments_dir = root.join("attachments");
        if !attachments_dir.is_dir() {
            return Err(ImportBundleError::AttachmentsDirMissing);
        }
        let attachments_manifest_path = root.join("attachments_manifest.txt");
        if !attachments_manifest_path.is_file() {
            return Err(ImportBundleError::AttachmentsManifestMissing);
        }

        let data_files = Self::resolve_data_files(&manifest.tables, &data_dir)?;
        let attachments = Self::load_attachments(&attachments_manifest_path)?;
        let total_size_bytes = Self::calculate_total_size(root)?;

        Ok(Self {
            root: root.to_path_buf(),
            manifest_path,
            data_dir,
            attachments_dir,
            attachments_manifest_path,
            manifest,
            attachments,
            data_files,
            total_size_bytes,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn manifest(&self) -> &ExportManifest {
        &self.manifest
    }

    pub fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn attachments_dir(&self) -> &Path {
        &self.attachments_dir
    }

    pub fn attachments_manifest_path(&self) -> &Path {
        &self.attachments_manifest_path
    }

    pub fn attachments(&self) -> &[AttachmentEntry] {
        &self.attachments
    }

    pub fn data_files(&self) -> &[DataFileEntry] {
        &self.data_files
    }

    pub fn total_size_bytes(&self) -> u64 {
        self.total_size_bytes
    }

    fn resolve_data_files(
        tables: &BTreeMap<String, crate::export::manifest::TableInfo>,
        data_dir: &Path,
    ) -> Result<Vec<DataFileEntry>, ImportBundleError> {
        let mut entries = Vec::new();
        for (logical_name, table) in tables.iter() {
            let file_name = format!("{logical_name}.jsonl");
            let path = data_dir.join(&file_name);
            if !path.is_file() {
                return Err(ImportBundleError::DataFileMissing(file_name));
            }
            entries.push(DataFileEntry {
                logical_name: logical_name.clone(),
                path,
                sha256: table.sha256.clone(),
                count: table.count,
            });
        }
        Ok(entries)
    }

    fn load_attachments(path: &Path) -> Result<Vec<AttachmentEntry>, ImportBundleError> {
        let reader = File::open(path).map(BufReader::new).map_err(|err| {
            ImportBundleError::AttachmentsManifestInvalid(format!(
                "failed to open {}: {}",
                path.display(),
                err
            ))
        })?;
        let mut entries = Vec::new();
        for line_res in reader.lines() {
            let line = line_res.map_err(|err| {
                ImportBundleError::AttachmentsManifestInvalid(format!(
                    "failed to read {}: {}",
                    path.display(),
                    err
                ))
            })?;
            if line.trim().is_empty() {
                continue;
            }
            let mut parts = line.splitn(2, '\t');
            let rel = parts.next().ok_or_else(|| {
                ImportBundleError::AttachmentsManifestInvalid("missing relative_path".into())
            })?;
            let hash = parts.next().ok_or_else(|| {
                ImportBundleError::AttachmentsManifestInvalid("missing sha256".into())
            })?;
            if hash.eq_ignore_ascii_case("MISSING") {
                return Err(ImportBundleError::AttachmentsManifestInvalid(format!(
                    "attachment listed as missing: {rel}"
                )));
            }
            entries.push(AttachmentEntry {
                relative_path: rel.to_string(),
                sha256: hash.to_string(),
            });
        }
        Ok(entries)
    }

    fn calculate_total_size(root: &Path) -> Result<u64, ImportBundleError> {
        fn walk(path: &Path) -> anyhow::Result<u64> {
            let meta =
                fs::metadata(path).with_context(|| format!("metadata for {}", path.display()))?;
            if meta.is_file() {
                return Ok(meta.len());
            }
            let mut total = 0_u64;
            for entry in
                fs::read_dir(path).with_context(|| format!("read_dir for {}", path.display()))?
            {
                let entry = entry?;
                total = total.saturating_add(walk(&entry.path())?);
            }
            Ok(total)
        }

        walk(root).map_err(|err| ImportBundleError::Walk { source: err })
    }

    pub fn verify_data_file_hash(&self, entry: &DataFileEntry) -> Result<(), ImportBundleError> {
        let actual = file_sha256(&entry.path).map_err(|err| ImportBundleError::Hash {
            path: entry.path.display().to_string(),
            source: err,
        })?;
        if actual != entry.sha256 {
            return Err(ImportBundleError::Hash {
                path: entry.path.display().to_string(),
                source: AnyError::msg(format!("expected {}, found {}", entry.sha256, actual)),
            });
        }
        Ok(())
    }

    pub fn verify_attachment_hash(&self, entry: &AttachmentEntry) -> Result<(), ImportBundleError> {
        let path = self.attachments_dir.join(&entry.relative_path);
        if !path.is_file() {
            return Err(ImportBundleError::AttachmentMissing(
                entry.relative_path.clone(),
            ));
        }
        let actual = file_sha256(&path).map_err(|err| ImportBundleError::Hash {
            path: path.display().to_string(),
            source: err,
        })?;
        if actual != entry.sha256 {
            return Err(ImportBundleError::Hash {
                path: path.display().to_string(),
                source: AnyError::msg(format!("expected {}, found {}", entry.sha256, actual)),
            });
        }
        Ok(())
    }

    pub fn verify_attachments_manifest(&self) -> Result<(), ImportBundleError> {
        let actual = file_sha256(&self.attachments_manifest_path).map_err(|err| {
            ImportBundleError::Hash {
                path: self.attachments_manifest_path.display().to_string(),
                source: err,
            }
        })?;
        if actual != self.manifest.attachments.sha256_manifest {
            return Err(ImportBundleError::Hash {
                path: self.attachments_manifest_path.display().to_string(),
                source: AnyError::msg(format!(
                    "expected {}, found {}",
                    self.manifest.attachments.sha256_manifest, actual
                )),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn load_bundle_success() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("attachments/sub")).unwrap();

        let data_path = root.join("data/households.jsonl");
        fs::write(&data_path, "{}\n").unwrap();
        let data_sha = file_sha256(&data_path).unwrap();

        let attachment_path = root.join("attachments/sub/file.txt");
        fs::write(&attachment_path, b"hello").unwrap();
        let attachment_sha = file_sha256(&attachment_path).unwrap();

        let attachments_manifest_path = root.join("attachments_manifest.txt");
        fs::write(
            &attachments_manifest_path,
            format!("sub/file.txt\t{}\n", attachment_sha),
        )
        .unwrap();
        let attachments_manifest_sha = file_sha256(&attachments_manifest_path).unwrap();

        let manifest = json!({
            "appVersion": "1.0.0",
            "schemaVersion": "20240101000000",
            "createdAt": "2024-01-01T00:00:00Z",
            "tables": {
                "households": {"count": 1, "sha256": data_sha},
            },
            "attachments": {
                "totalCount": 1,
                "totalBytes": 5,
                "sha256Manifest": attachments_manifest_sha,
            }
        });
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let bundle = ImportBundle::load(root).unwrap();
        assert_eq!(bundle.data_files().len(), 1);
        assert_eq!(bundle.attachments().len(), 1);
        assert!(bundle.total_size_bytes() > 0);
    }
}
