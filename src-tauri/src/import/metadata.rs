use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::str::FromStr;

use serde_json::Value;

use crate::attachment_category::AttachmentCategory;

use super::{ImportBundle, ATTACHMENT_TABLES};

#[derive(Debug, Clone)]
pub(crate) struct BundleAttachmentMetadata {
    pub(crate) household_id: String,
    pub(crate) category: AttachmentCategory,
    pub(crate) updated_at: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum MetadataIssue {
    #[error("failed to read data file {path}: {source}")]
    DataFileIo {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse json in {path}: {source}")]
    DataFileParse {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("attachment {path} missing household metadata in bundle")]
    MissingHousehold { path: String },
    #[error("attachment {path} missing category metadata in bundle")]
    MissingCategory { path: String },
    #[error("attachment {path} has invalid category {category}")]
    InvalidCategory { path: String, category: String },
    #[error("attachment {path} has conflicting metadata in bundle")]
    Conflict { path: String },
}

pub(crate) fn collect_bundle_attachment_metadata(
    bundle: &ImportBundle,
) -> Result<HashMap<String, BundleAttachmentMetadata>, MetadataIssue> {
    let mut map: HashMap<String, BundleAttachmentMetadata> = HashMap::new();

    for entry in bundle.data_files() {
        if !ATTACHMENT_TABLES
            .iter()
            .any(|table| *table == entry.logical_name.as_str())
        {
            continue;
        }

        let file = File::open(&entry.path).map_err(|source| MetadataIssue::DataFileIo {
            path: entry.path.display().to_string(),
            source,
        })?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|source| MetadataIssue::DataFileIo {
                path: entry.path.display().to_string(),
                source,
            })?;
            if line.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&line).map_err(|source| MetadataIssue::DataFileParse {
                    path: entry.path.display().to_string(),
                    source,
                })?;
            let root_key = value.get("root_key").and_then(|v| v.as_str());
            if !matches!(root_key, Some("attachments")) {
                continue;
            }

            let Some(rel) = value
                .get("relative_path")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            else {
                continue;
            };

            let Some(household_id) = value
                .get("household_id")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            else {
                return Err(MetadataIssue::MissingHousehold {
                    path: rel.to_string(),
                });
            };

            let category = if let Some(cat_raw) = value
                .get("category")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                AttachmentCategory::from_str(cat_raw).map_err(|_| {
                    MetadataIssue::InvalidCategory {
                        path: rel.to_string(),
                        category: cat_raw.to_string(),
                    }
                })?
            } else {
                AttachmentCategory::for_table(&entry.logical_name).ok_or_else(|| {
                    MetadataIssue::MissingCategory {
                        path: rel.to_string(),
                    }
                })?
            };

            let updated_at = value.get("updated_at").and_then(|v| v.as_i64());

            match map.entry(rel.to_string()) {
                Entry::Vacant(slot) => {
                    slot.insert(BundleAttachmentMetadata {
                        household_id: household_id.to_string(),
                        category,
                        updated_at,
                    });
                }
                Entry::Occupied(mut slot) => {
                    let existing = slot.get_mut();
                    if existing.household_id != household_id || existing.category != category {
                        return Err(MetadataIssue::Conflict {
                            path: rel.to_string(),
                        });
                    }
                    if let Some(ts) = updated_at {
                        if existing.updated_at.map_or(true, |current| ts > current) {
                            existing.updated_at = Some(ts);
                        }
                    }
                }
            }
        }
    }

    Ok(map)
}

pub(crate) fn collect_bundle_attachment_updates(
    bundle: &ImportBundle,
) -> Result<HashMap<String, i64>, MetadataIssue> {
    let mut map = HashMap::new();

    for entry in bundle.data_files() {
        if !ATTACHMENT_TABLES
            .iter()
            .any(|table| *table == entry.logical_name.as_str())
        {
            continue;
        }

        let file = File::open(&entry.path).map_err(|source| MetadataIssue::DataFileIo {
            path: entry.path.display().to_string(),
            source,
        })?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|source| MetadataIssue::DataFileIo {
                path: entry.path.display().to_string(),
                source,
            })?;
            if line.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&line).map_err(|source| MetadataIssue::DataFileParse {
                    path: entry.path.display().to_string(),
                    source,
                })?;
            let root_key = value.get("root_key").and_then(|v| v.as_str());
            if !matches!(root_key, Some("attachments")) {
                continue;
            }

            let Some(rel) = value
                .get("relative_path")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            else {
                continue;
            };

            if let Some(updated_at) = value.get("updated_at").and_then(|v| v.as_i64()) {
                map.entry(rel.to_string())
                    .and_modify(|existing| {
                        if updated_at > *existing {
                            *existing = updated_at;
                        }
                    })
                    .or_insert(updated_at);
            }
        }
    }

    Ok(map)
}
