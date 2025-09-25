use std::{collections::BTreeMap, fs::File, io::Read, path::Path};

use anyhow::{Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TableInfo {
    #[ts(type = "number")]
    pub count: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AttachmentsInfo {
    #[ts(type = "number")]
    pub total_count: u64,
    #[ts(type = "number")]
    pub total_bytes: u64,
    pub sha256_manifest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ExportManifest {
    pub app_version: String,
    pub schema_version: String,
    pub created_at: String,
    pub tables: BTreeMap<String, TableInfo>,
    pub attachments: AttachmentsInfo,
}

impl ExportManifest {
    pub fn new(app_version: impl Into<String>, schema_version: impl Into<String>) -> Self {
        Self {
            app_version: app_version.into(),
            schema_version: schema_version.into(),
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            tables: BTreeMap::new(),
            attachments: AttachmentsInfo::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn export_manifest_defaults() {
        let m = ExportManifest::new("1.0.0", "0020_files_index_fks");
        assert_eq!(m.app_version, "1.0.0");
        assert_eq!(m.schema_version, "0020_files_index_fks");
        assert!(m.created_at.contains('T'));
        assert!(m.tables.is_empty());
        assert_eq!(m.attachments.total_count, 0);
        assert_eq!(m.attachments.total_bytes, 0);
        assert_eq!(m.attachments.sha256_manifest, "");
    }

    #[test]
    fn file_sha256_hashes_content() {
        let mut tmp = NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut tmp, b"abc123").unwrap();
        let hash = file_sha256(tmp.path()).unwrap();
        let expected = format!("{:x}", sha2::Sha256::digest(b"abc123"));
        assert_eq!(hash, expected);
    }
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
