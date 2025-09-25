use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;

use super::bundle::{DataFileEntry, ImportBundle};
use super::ATTACHMENT_TABLES;
use crate::export::manifest::file_sha256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ImportMode {
    Merge,
    Replace,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TablePlan {
    #[ts(type = "number")]
    pub adds: u64,
    #[ts(type = "number")]
    pub updates: u64,
    #[ts(type = "number")]
    pub skips: u64,
    pub conflicts: Vec<TableConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TableConflict {
    pub table: String,
    pub id: String,
    #[ts(type = "number | null")]
    pub bundle_updated_at: Option<i64>,
    #[ts(type = "number | null")]
    pub live_updated_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AttachmentsPlan {
    #[ts(type = "number")]
    pub adds: u64,
    #[ts(type = "number")]
    pub updates: u64,
    #[ts(type = "number")]
    pub skips: u64,
    pub conflicts: Vec<AttachmentConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AttachmentConflict {
    pub relative_path: String,
    #[ts(type = "number | null")]
    pub bundle_updated_at: Option<i64>,
    #[ts(type = "number | null")]
    pub live_updated_at: Option<i64>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ImportPlan {
    pub mode: ImportMode,
    pub tables: BTreeMap<String, TablePlan>,
    pub attachments: AttachmentsPlan,
}

#[derive(Debug, Clone)]
pub struct PlanContext<'a> {
    pub pool: &'a SqlitePool,
    pub attachments_root: &'a Path,
}

#[derive(Debug, Error)]
pub enum PlanError {
    #[error("invalid table in manifest: {0}")]
    InvalidTable(String),
    #[error("failed to read data file {path}: {source}")]
    DataFileIo { path: String, source: String },
    #[error("failed to parse json in {path}: {source}")]
    DataFileParse { path: String, source: String },
    #[error("record in {table} missing required field {field}")]
    MissingField { table: String, field: String },
    #[error("database error: {0}")]
    Database(String),
    #[error("attachment path escapes base: {0}")]
    AttachmentPathTraversal(String),
    #[error("failed to inspect attachment {path}: {source}")]
    AttachmentIo { path: String, source: String },
}

pub async fn build_plan(
    bundle: &ImportBundle,
    ctx: &PlanContext<'_>,
    mode: ImportMode,
) -> Result<ImportPlan, PlanError> {
    let mut tables = BTreeMap::new();

    for data_entry in bundle.data_files() {
        let plan = match mode {
            ImportMode::Replace => plan_table_replace(data_entry),
            ImportMode::Merge => plan_table_merge(ctx.pool, data_entry).await?,
        };
        tables.insert(data_entry.logical_name.clone(), plan);
    }

    let attachments = match mode {
        ImportMode::Replace => plan_attachments_replace(bundle),
        ImportMode::Merge => plan_attachments_merge(bundle, ctx).await?,
    };

    Ok(ImportPlan {
        mode,
        tables,
        attachments,
    })
}

fn plan_table_replace(entry: &DataFileEntry) -> TablePlan {
    TablePlan {
        adds: entry.count,
        updates: 0,
        skips: 0,
        conflicts: Vec::new(),
    }
}

async fn plan_table_merge(
    pool: &SqlitePool,
    entry: &DataFileEntry,
) -> Result<TablePlan, PlanError> {
    let table = resolve_physical_table(&entry.logical_name)?;
    let sql = format!("SELECT updated_at, deleted_at FROM {} WHERE id = ?1", table);

    let file = File::open(&entry.path).map_err(|err| PlanError::DataFileIo {
        path: entry.path.display().to_string(),
        source: err.to_string(),
    })?;
    let reader = BufReader::new(file);

    let mut adds = 0_u64;
    let mut updates = 0_u64;
    let mut skips = 0_u64;
    let mut conflicts = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|err| PlanError::DataFileIo {
            path: entry.path.display().to_string(),
            source: err.to_string(),
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&line).map_err(|err| PlanError::DataFileParse {
            path: entry.path.display().to_string(),
            source: err.to_string(),
        })?;

        let id = extract_id(&entry.logical_name, &value)?;
        let bundle_updated = value.get("updated_at").and_then(|v| v.as_i64());

        let mut query = sqlx::query(&sql);
        match &id {
            IdValue::Int(v) => {
                query = query.bind(*v);
            }
            IdValue::String(s) => {
                query = query.bind(s);
            }
        }

        let row = query
            .fetch_optional(pool)
            .await
            .map_err(|err| PlanError::Database(err.to_string()))?;

        if let Some(row) = row {
            let deleted: Option<i64> = row.try_get("deleted_at").ok();
            let live_updated: Option<i64> = row.try_get("updated_at").ok();

            if deleted.is_some() {
                updates += 1;
                continue;
            }

            match (bundle_updated, live_updated) {
                (Some(bundle_ts), Some(live_ts)) => {
                    if bundle_ts > live_ts {
                        updates += 1;
                    } else if bundle_ts < live_ts {
                        skips += 1;
                        conflicts.push(TableConflict {
                            table: entry.logical_name.clone(),
                            id: id.to_string(),
                            bundle_updated_at: Some(bundle_ts),
                            live_updated_at: Some(live_ts),
                        });
                    } else {
                        skips += 1;
                    }
                }
                (Some(_), None) => {
                    updates += 1;
                }
                (None, Some(_)) => {
                    skips += 1;
                    conflicts.push(TableConflict {
                        table: entry.logical_name.clone(),
                        id: id.to_string(),
                        bundle_updated_at,
                        live_updated_at,
                    });
                }
                (None, None) => {
                    updates += 1;
                }
            }
        } else {
            adds += 1;
        }
    }

    Ok(TablePlan {
        adds,
        updates,
        skips,
        conflicts,
    })
}

fn plan_attachments_replace(bundle: &ImportBundle) -> AttachmentsPlan {
    AttachmentsPlan {
        adds: bundle.attachments().len() as u64,
        updates: 0,
        skips: 0,
        conflicts: Vec::new(),
    }
}

async fn plan_attachments_merge(
    bundle: &ImportBundle,
    ctx: &PlanContext<'_>,
) -> Result<AttachmentsPlan, PlanError> {
    let mut plan = AttachmentsPlan::default();
    let bundle_updated_index = collect_bundle_attachment_updates(bundle)?;

    for attachment in bundle.attachments() {
        let rel = &attachment.relative_path;
        ensure_safe_relative_path(rel)?;
        let target = ctx.attachments_root.join(rel);
        let bundle_updated_at = bundle_updated_index.get(rel).copied();
        let live_updated_at = load_live_attachment_updated_at(ctx.pool, rel).await?;
        if !target.exists() {
            plan.adds += 1;
            continue;
        }
        let existing_hash = file_sha256(&target).map_err(|err| PlanError::AttachmentIo {
            path: target.display().to_string(),
            source: err.to_string(),
        })?;
        if existing_hash == attachment.sha256 {
            plan.skips += 1;
            continue;
        }

        match decide_attachment_action(bundle_updated_at, live_updated_at) {
            AttachmentAction::BundleWins { reason } => {
                plan.updates += 1;
                plan.conflicts.push(AttachmentConflict {
                    relative_path: rel.clone(),
                    bundle_updated_at,
                    live_updated_at,
                    reason,
                });
            }
            AttachmentAction::LiveWins { reason } => {
                plan.skips += 1;
                plan.conflicts.push(AttachmentConflict {
                    relative_path: rel.clone(),
                    bundle_updated_at,
                    live_updated_at,
                    reason,
                });
            }
        }
    }

    Ok(plan)
}

fn collect_bundle_attachment_updates(
    bundle: &ImportBundle,
) -> Result<HashMap<String, i64>, PlanError> {
    let mut map = HashMap::new();
    for entry in bundle.data_files() {
        if !ATTACHMENT_TABLES
            .iter()
            .any(|table| *table == entry.logical_name.as_str())
        {
            continue;
        }

        let file = File::open(&entry.path).map_err(|err| PlanError::DataFileIo {
            path: entry.path.display().to_string(),
            source: err.to_string(),
        })?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|err| PlanError::DataFileIo {
                path: entry.path.display().to_string(),
                source: err.to_string(),
            })?;
            if line.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&line).map_err(|err| PlanError::DataFileParse {
                    path: entry.path.display().to_string(),
                    source: err.to_string(),
                })?;
            let root_key = value.get("root_key").and_then(|v| v.as_str());
            if !matches!(root_key, Some("attachments")) {
                continue;
            }
            let rel = match value.get("relative_path").and_then(|v| v.as_str()) {
                Some(rel) if !rel.trim().is_empty() => rel,
                _ => continue,
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

async fn load_live_attachment_updated_at(
    pool: &SqlitePool,
    rel: &str,
) -> Result<Option<i64>, PlanError> {
    let mut max_ts: Option<i64> = None;
    for table in ATTACHMENT_TABLES {
        let sql = format!(
            "SELECT MAX(updated_at) FROM {table} WHERE root_key = 'attachments' AND relative_path = ?1 AND deleted_at IS NULL"
        );
        let ts: Option<i64> = sqlx::query_scalar(&sql)
            .bind(rel)
            .fetch_one(pool)
            .await
            .map_err(|err| PlanError::Database(err.to_string()))?;
        if let Some(ts) = ts {
            if max_ts.map_or(true, |current| ts > current) {
                max_ts = Some(ts);
            }
        }
    }
    Ok(max_ts)
}

enum AttachmentAction {
    BundleWins { reason: String },
    LiveWins { reason: String },
}

fn decide_attachment_action(
    bundle_updated_at: Option<i64>,
    live_updated_at: Option<i64>,
) -> AttachmentAction {
    match (bundle_updated_at, live_updated_at) {
        (Some(bundle), Some(live)) => {
            if bundle > live {
                AttachmentAction::BundleWins {
                    reason: format!(
                        "bundle newer (bundle updated_at {bundle} > live {live}); overwriting local copy"
                    ),
                }
            } else if bundle < live {
                AttachmentAction::LiveWins {
                    reason: format!(
                        "local newer (live updated_at {live} >= bundle {bundle}); keeping existing copy"
                    ),
                }
            } else {
                AttachmentAction::LiveWins {
                    reason: format!(
                        "timestamps equal (updated_at {bundle}); keeping existing copy"
                    ),
                }
            }
        }
        (Some(_), None) => AttachmentAction::BundleWins {
            reason: "bundle newer (no live timestamp); overwriting local copy".to_string(),
        },
        (None, Some(live)) => AttachmentAction::LiveWins {
            reason: format!(
                "local newer (live updated_at {live}; bundle missing timestamp); keeping existing copy"
            ),
        },
        (None, None) => AttachmentAction::BundleWins {
            reason: "hash mismatch with no timestamps; defaulting to bundle copy".to_string(),
        },
    }
}

fn resolve_physical_table(logical: &str) -> Result<&'static str, PlanError> {
    match logical {
        "households" => Ok("household"),
        "events" => Ok("events"),
        "notes" => Ok("notes"),
        "files" => Ok("files_index"),
        "bills" => Ok("bills"),
        "policies" => Ok("policies"),
        "property_documents" => Ok("property_documents"),
        "inventory_items" => Ok("inventory_items"),
        "vehicle_maintenance" => Ok("vehicle_maintenance"),
        "pet_medical" => Ok("pet_medical"),
        other => Err(PlanError::InvalidTable(other.to_string())),
    }
}

fn ensure_safe_relative_path(rel: &str) -> Result<(), PlanError> {
    let path = Path::new(rel);
    if path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(PlanError::AttachmentPathTraversal(rel.to_string()));
    }
    Ok(())
}

#[derive(Debug)]
enum IdValue {
    Int(i64),
    String(String),
}

impl IdValue {
    fn to_string(&self) -> String {
        match self {
            IdValue::Int(v) => v.to_string(),
            IdValue::String(s) => s.clone(),
        }
    }
}

fn extract_id(table: &str, value: &Value) -> Result<IdValue, PlanError> {
    let id = value.get("id").ok_or_else(|| PlanError::MissingField {
        table: table.to_string(),
        field: "id".to_string(),
    })?;
    if let Some(v) = id.as_i64() {
        return Ok(IdValue::Int(v));
    }
    if let Some(s) = id.as_str() {
        return Ok(IdValue::String(s.to_string()));
    }
    Err(PlanError::MissingField {
        table: table.to_string(),
        field: "id".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::manifest::file_sha256;
    use serde_json::json;
    use tempfile::TempDir;

    async fn setup_pool() -> SqlitePool {
        SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite pool")
    }

    fn write_bundle(
        root: &Path,
        logical: &str,
        rows: &[Value],
        attachments: &[(String, Vec<u8>)],
    ) -> ImportBundle {
        use std::io::Write;

        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::create_dir_all(root.join("attachments")).unwrap();
        let data_path = root.join("data").join(format!("{}.jsonl", logical));
        let mut file = std::fs::File::create(&data_path).unwrap();
        for row in rows {
            serde_json::to_writer(&mut file, row).unwrap();
            file.write_all(b"\n").unwrap();
        }
        file.flush().unwrap();
        drop(file);
        let data_sha = file_sha256(&data_path).unwrap();

        let attachments_manifest_path = root.join("attachments_manifest.txt");
        let mut manifest_file = std::fs::File::create(&attachments_manifest_path).unwrap();
        let mut attach_entries = Vec::new();
        for (rel, bytes) in attachments {
            let dest = root.join("attachments").join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&dest, bytes).unwrap();
            let hash = file_sha256(&dest).unwrap();
            use std::io::Write;
            writeln!(manifest_file, "{}\t{}", rel, hash).unwrap();
            attach_entries.push((rel.clone(), hash));
        }
        manifest_file.flush().unwrap();
        drop(manifest_file);
        let attachments_manifest_sha = file_sha256(&attachments_manifest_path).unwrap();

        let manifest = json!({
            "appVersion": "1.0.0",
            "schemaVersion": "20240101000000",
            "createdAt": "2024-01-01T00:00:00Z",
            "tables": {
                logical: {"count": rows.len() as u64, "sha256": data_sha},
            },
            "attachments": {
                "totalCount": attach_entries.len() as u64,
                "totalBytes": attachments.iter().map(|(_, b)| b.len() as u64).sum::<u64>(),
                "sha256Manifest": attachments_manifest_sha,
            }
        });
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        ImportBundle::load(root).unwrap()
    }

    #[tokio::test]
    async fn merge_plan_detects_conflicts() {
        let pool = setup_pool().await;
        sqlx::query(
            "CREATE TABLE events (id TEXT PRIMARY KEY, updated_at INTEGER, deleted_at INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO events (id, updated_at, deleted_at) VALUES (?1, ?2, NULL)")
            .bind("evt_keep")
            .bind(300_i64)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO events (id, updated_at, deleted_at) VALUES (?1, ?2, NULL)")
            .bind("evt_update")
            .bind(150_i64)
            .execute(&pool)
            .await
            .unwrap();

        let tmp = TempDir::new().unwrap();
        let rows = vec![
            json!({"id": "evt_keep", "updated_at": 200}),
            json!({"id": "evt_update", "updated_at": 250}),
            json!({"id": "evt_new", "updated_at": 100}),
        ];
        let bundle = write_bundle(tmp.path(), "events", &rows, &[]);
        let attachments_root = TempDir::new().unwrap();
        let ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };

        let plan = build_plan(&bundle, &ctx, ImportMode::Merge).await.unwrap();
        let events = plan.tables.get("events").unwrap();
        assert_eq!(events.adds, 1);
        assert_eq!(events.updates, 1);
        assert_eq!(events.skips, 1);
        assert_eq!(events.conflicts.len(), 1);
        assert_eq!(events.conflicts[0].id, "evt_keep");
        assert_eq!(plan.attachments.adds, 0);
    }

    #[tokio::test]
    async fn replace_plan_counts_all_rows() {
        let pool = setup_pool().await;
        sqlx::query(
            "CREATE TABLE notes (id TEXT PRIMARY KEY, updated_at INTEGER, deleted_at INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let tmp = TempDir::new().unwrap();
        let rows = vec![
            json!({"id": "n1", "updated_at": 10}),
            json!({"id": "n2", "updated_at": 20}),
        ];
        let attachments = vec![("docs/file.txt".to_string(), b"hello".to_vec())];
        let bundle = write_bundle(tmp.path(), "notes", &rows, &attachments);
        let attachments_root = TempDir::new().unwrap();
        let ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };

        let plan = build_plan(&bundle, &ctx, ImportMode::Replace)
            .await
            .unwrap();
        let notes = plan.tables.get("notes").unwrap();
        assert_eq!(notes.adds, 2);
        assert_eq!(notes.updates, 0);
        assert_eq!(notes.skips, 0);
        assert_eq!(plan.attachments.adds, 1);
        assert_eq!(plan.attachments.updates, 0);
        assert_eq!(plan.attachments.skips, 0);
    }

    #[tokio::test]
    async fn attachment_plan_detects_updates() {
        let pool = setup_pool().await;
        sqlx::query(
            "CREATE TABLE bills (id TEXT PRIMARY KEY, updated_at INTEGER, deleted_at INTEGER, root_key TEXT, relative_path TEXT)",
        )
            .execute(&pool)
            .await
            .unwrap();

        let tmp = TempDir::new().unwrap();
        let rows = vec![json!({
            "id": "bill1",
            "updated_at": 200,
            "root_key": "attachments",
            "relative_path": "diff/file.txt",
        })];
        let attachments = vec![
            ("same/file.txt".to_string(), b"abc".to_vec()),
            ("diff/file.txt".to_string(), b"bundle".to_vec()),
        ];
        let bundle = write_bundle(tmp.path(), "bills", &rows, &attachments);

        let attachments_root = TempDir::new().unwrap();
        let same_path = attachments_root.path().join("same/file.txt");
        std::fs::create_dir_all(same_path.parent().unwrap()).unwrap();
        std::fs::write(&same_path, b"abc").unwrap();
        let diff_path = attachments_root.path().join("diff/file.txt");
        std::fs::create_dir_all(diff_path.parent().unwrap()).unwrap();
        std::fs::write(&diff_path, b"local").unwrap();

        sqlx::query("INSERT INTO bills (id, updated_at, deleted_at) VALUES (?1, ?2, NULL)")
            .bind("bill1")
            .bind(100_i64)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE bills SET root_key = 'attachments', relative_path = 'diff/file.txt' WHERE id = ?1",
        )
        .bind("bill1")
        .execute(&pool)
        .await
        .unwrap();

        let ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };

        let plan = build_plan(&bundle, &ctx, ImportMode::Merge).await.unwrap();
        assert_eq!(plan.attachments.adds, 0);
        assert_eq!(plan.attachments.updates, 1);
        assert_eq!(plan.attachments.skips, 1);
        assert_eq!(plan.attachments.conflicts.len(), 1);
        assert_eq!(plan.attachments.conflicts[0].relative_path, "diff/file.txt");
        assert!(plan.attachments.conflicts[0]
            .reason
            .contains("bundle newer (bundle updated_at 200"));
    }

    #[tokio::test]
    async fn attachment_plan_skips_when_live_newer() {
        let pool = setup_pool().await;
        sqlx::query(
            "CREATE TABLE bills (id TEXT PRIMARY KEY, updated_at INTEGER, deleted_at INTEGER, root_key TEXT, relative_path TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let tmp = TempDir::new().unwrap();
        let rows = vec![json!({
            "id": "bill2",
            "updated_at": 150,
            "root_key": "attachments",
            "relative_path": "docs/file.txt",
        })];
        let attachments = vec![("docs/file.txt".to_string(), b"bundle".to_vec())];
        let bundle = write_bundle(tmp.path(), "bills", &rows, &attachments);

        let attachments_root = TempDir::new().unwrap();
        let dest_path = attachments_root.path().join("docs/file.txt");
        std::fs::create_dir_all(dest_path.parent().unwrap()).unwrap();
        std::fs::write(&dest_path, b"local").unwrap();

        sqlx::query("INSERT INTO bills (id, updated_at, deleted_at, root_key, relative_path) VALUES (?1, ?2, NULL, 'attachments', ?3)")
            .bind("bill2")
            .bind(300_i64)
            .bind("docs/file.txt")
            .execute(&pool)
            .await
            .unwrap();

        let ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };

        let plan = build_plan(&bundle, &ctx, ImportMode::Merge).await.unwrap();
        assert_eq!(plan.attachments.adds, 0);
        assert_eq!(plan.attachments.updates, 0);
        assert_eq!(plan.attachments.skips, 1);
        assert_eq!(plan.attachments.conflicts.len(), 1);
        let conflict = &plan.attachments.conflicts[0];
        assert_eq!(conflict.relative_path, "docs/file.txt");
        assert!(conflict.reason.contains("local newer (live updated_at 300"));
        assert_eq!(conflict.bundle_updated_at, Some(150));
        assert_eq!(conflict.live_updated_at, Some(300));
    }
}
