use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

use anyhow::Error as AnyError;
use serde::de::Error as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::pool::PoolConnection;
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use thiserror::Error;
use ts_rs::TS;

use super::bundle::{AttachmentEntry, DataFileEntry, ImportBundle};
use super::plan::{AttachmentConflict, ImportMode, ImportPlan, TableConflict, TablePlan};
use super::rows::canonicalize_row;
use super::ATTACHMENT_TABLES;
use crate::export::manifest::file_sha256;
use crate::migrate;

const ROW_CHUNK_SIZE: usize = 500;

#[derive(Debug, Clone)]
pub struct ExecutionContext<'a> {
    pub pool: &'a SqlitePool,
    pub attachments_root: &'a Path,
    pub clear_attachments_on_replace: bool,
}

impl<'a> ExecutionContext<'a> {
    pub fn new(pool: &'a SqlitePool, attachments_root: &'a Path) -> Self {
        Self {
            pool,
            attachments_root,
            clear_attachments_on_replace: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TableExecutionSummary {
    #[ts(type = "number")]
    pub adds: u64,
    #[ts(type = "number")]
    pub updates: u64,
    #[ts(type = "number")]
    pub skips: u64,
    pub conflicts: Vec<TableConflict>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AttachmentExecutionSummary {
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
pub struct ExecutionReport {
    pub mode: ImportMode,
    pub tables: BTreeMap<String, TableExecutionSummary>,
    pub attachments: AttachmentExecutionSummary,
}

#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("plan drift detected for table {table}: {field} expected {expected} got {actual}")]
    PlanDrift {
        table: String,
        field: &'static str,
        expected: u64,
        actual: u64,
    },
    #[error("plan conflict mismatch for table {table}")]
    PlanConflictMismatch { table: String },
    #[error("plan drift detected for attachments field {field}: expected {expected} got {actual}")]
    AttachmentPlanDrift {
        field: &'static str,
        expected: u64,
        actual: u64,
    },
    #[error("attachment conflicts diverged from plan")]
    AttachmentConflictMismatch,
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
    #[error("failed to normalize row for table {table}: {source}")]
    RowNormalization {
        table: String,
        #[source]
        source: AnyError,
    },
    #[error("missing required field {field} in table {table}")]
    MissingField { table: String, field: String },
    #[error("unknown table in import bundle: {0}")]
    UnknownTable(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("failed to apply migrations: {0}")]
    Migration(#[source] AnyError),
    #[error("attachment path escapes base: {0}")]
    AttachmentPathTraversal(String),
    #[error("failed to copy attachment {path}: {source}")]
    AttachmentIo {
        path: String,
        #[source]
        source: AnyError,
    },
    #[error("hash mismatch after copying attachment {path}")]
    AttachmentHashMismatch { path: String },
}

pub async fn execute_plan(
    bundle: &ImportBundle,
    plan: &ImportPlan,
    ctx: &ExecutionContext<'_>,
) -> Result<ExecutionReport, ExecutionError> {
    let table_entries = bundle.data_files();

    if matches!(plan.mode, ImportMode::Replace) {
        rebuild_database_schema(ctx).await?;
        for entry in table_entries.iter().rev() {
            clear_table(entry, ctx).await?;
        }
    }

    // Attachments handled per mode below

    let mut tables = BTreeMap::new();

    for entry in table_entries {
        if let Some(expected) = plan.tables.get(&entry.logical_name) {
            let summary = match plan.mode {
                ImportMode::Replace => execute_table_replace(entry, expected, ctx).await?,
                ImportMode::Merge => execute_table_merge(entry, expected, ctx).await?,
            };
            tables.insert(entry.logical_name.clone(), summary);
        }
    }

    let attachments = match plan.mode {
        ImportMode::Replace => execute_attachments_replace(bundle, &plan.attachments, ctx)?,
        ImportMode::Merge => execute_attachments_merge(bundle, &plan.attachments, ctx).await?,
    };

    Ok(ExecutionReport {
        mode: plan.mode,
        tables,
        attachments,
    })
}

async fn rebuild_database_schema(ctx: &ExecutionContext<'_>) -> Result<(), ExecutionError> {
    let mut conn = ctx.pool.acquire().await.map_err(ExecutionError::Database)?;

    sqlx::query("PRAGMA foreign_keys=OFF")
        .execute(conn.as_mut())
        .await
        .map_err(ExecutionError::Database)?;

    let objects = sqlx::query_as::<_, (String, String)>(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(conn.as_mut())
    .await
    .map_err(ExecutionError::Database)?;

    let mut drops: Vec<(u8, String, String)> = objects
        .into_iter()
        .filter_map(|(obj_type, name)| {
            if name.starts_with("sqlite_") {
                return None;
            }
            let priority = match obj_type.as_str() {
                "view" => 0,
                "trigger" => 1,
                "index" => 2,
                "table" => 3,
                _ => return None,
            };
            Some((priority, obj_type, name))
        })
        .collect();

    drops.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2)));

    for (_, obj_type, name) in drops {
        drop_schema_object(&mut conn, &obj_type, &name).await?;
    }

    let _ = sqlx::query("DELETE FROM sqlite_sequence")
        .execute(conn.as_mut())
        .await;

    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(conn.as_mut())
        .await
        .map_err(ExecutionError::Database)?;

    drop(conn);

    migrate::apply_migrations(ctx.pool)
        .await
        .map_err(ExecutionError::Migration)?;

    Ok(())
}

async fn drop_schema_object(
    conn: &mut PoolConnection<Sqlite>,
    obj_type: &str,
    name: &str,
) -> Result<(), ExecutionError> {
    let sql = match obj_type {
        "view" => format!("DROP VIEW {}", quote_ident(name)),
        "trigger" => format!("DROP TRIGGER {}", quote_ident(name)),
        "index" => format!("DROP INDEX {}", quote_ident(name)),
        "table" => format!("DROP TABLE {}", quote_ident(name)),
        _ => return Ok(()),
    };

    sqlx::query(&sql)
        .execute(conn.as_mut())
        .await
        .map_err(ExecutionError::Database)?;

    Ok(())
}

async fn execute_table_replace(
    entry: &DataFileEntry,
    expected: &TablePlan,
    ctx: &ExecutionContext<'_>,
) -> Result<TableExecutionSummary, ExecutionError> {
    let table = resolve_physical_table(&entry.logical_name)?;
    let summary = import_table_rows(
        entry,
        ctx.pool,
        &entry.logical_name,
        table,
        ImportMode::Replace,
    )
    .await?;

    verify_table_summary(&entry.logical_name, expected, &summary)?;
    Ok(summary)
}

async fn clear_table(
    entry: &DataFileEntry,
    ctx: &ExecutionContext<'_>,
) -> Result<(), ExecutionError> {
    let table = resolve_physical_table(&entry.logical_name)?;
    let mut conn = ctx.pool.acquire().await.map_err(ExecutionError::Database)?;
    let delete_sql = format!("DELETE FROM {}", quote_ident(table));
    sqlx::query(&delete_sql)
        .execute(conn.as_mut())
        .await
        .map_err(ExecutionError::Database)?;
    Ok(())
}

async fn execute_table_merge(
    entry: &DataFileEntry,
    expected: &TablePlan,
    ctx: &ExecutionContext<'_>,
) -> Result<TableExecutionSummary, ExecutionError> {
    let table = resolve_physical_table(&entry.logical_name)?;

    let summary = import_table_rows(
        entry,
        ctx.pool,
        &entry.logical_name,
        table,
        ImportMode::Merge,
    )
    .await?;

    verify_table_summary(&entry.logical_name, expected, &summary)?;
    Ok(summary)
}

async fn import_table_rows(
    entry: &DataFileEntry,
    pool: &SqlitePool,
    logical_table: &str,
    physical_table: &str,
    mode: ImportMode,
) -> Result<TableExecutionSummary, ExecutionError> {
    let file = fs::File::open(&entry.path).map_err(|err| ExecutionError::DataFileIo {
        path: entry.path.display().to_string(),
        source: err,
    })?;
    let reader = BufReader::new(file);

    let mut summary = TableExecutionSummary::default();
    let mut inserter: Option<TableInserter> = None;
    let mut tx: Option<Transaction<'_, Sqlite>> = None;
    let mut chunk_len: usize = 0;

    for line in reader.lines() {
        let line = line.map_err(|err| ExecutionError::DataFileIo {
            path: entry.path.display().to_string(),
            source: err,
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut value: Value =
            serde_json::from_str(trimmed).map_err(|err| ExecutionError::DataFileParse {
                path: entry.path.display().to_string(),
                source: err,
            })?;
        value = canonicalize_row(logical_table, value).map_err(|err| {
            ExecutionError::RowNormalization {
                table: logical_table.to_string(),
                source: err,
            }
        })?;
        let object = value
            .as_object()
            .ok_or_else(|| ExecutionError::DataFileParse {
                path: entry.path.display().to_string(),
                source: serde_json::Error::custom("expected object"),
            })?;
        if inserter.is_none() {
            inserter = Some(TableInserter::prepare(physical_table, object)?);
        }

        if tx.is_none() {
            tx = Some(pool.begin().await.map_err(ExecutionError::Database)?);
            chunk_len = 0;
        }

        let tx_ref = match tx.as_mut() {
            Some(tx) => tx,
            None => unreachable!("transaction should be initialized before use"),
        };

        match mode {
            ImportMode::Replace => {
                if let Some(ins) = inserter.as_ref() {
                    ins.insert(tx_ref, &value).await?;
                } else {
                    unreachable!("inserter initialized on first row");
                }
                summary.adds += 1;
            }
            ImportMode::Merge => {
                process_merge_row(
                    logical_table,
                    physical_table,
                    &value,
                    tx_ref,
                    if let Some(ins) = inserter.as_ref() { ins } else { unreachable!("inserter initialized on first row") },
                    &mut summary,
                )
                .await?;
            }
        }

        chunk_len += 1;

        if chunk_len >= ROW_CHUNK_SIZE {
            if let Some(active) = tx.take() {
                active.commit().await.map_err(ExecutionError::Database)?;
            }
        }
    }

    if let Some(active) = tx.take() {
        active.commit().await.map_err(ExecutionError::Database)?;
    }

    Ok(summary)
}

async fn process_merge_row(
    logical_table: &str,
    physical_table: &str,
    row: &Value,
    tx: &mut Transaction<'_, Sqlite>,
    inserter: &TableInserter,
    summary: &mut TableExecutionSummary,
) -> Result<(), ExecutionError> {
    let id = extract_id(logical_table, row)?;
    let bundle_updated = row.get("updated_at").and_then(|v| v.as_i64());
    let select_sql = format!(
        "SELECT updated_at, deleted_at FROM {} WHERE id = ?1",
        quote_ident(physical_table)
    );
    let mut query = sqlx::query(&select_sql);
    match &id {
        IdValue::Int(v) => {
            query = query.bind(*v);
        }
        IdValue::String(s) => {
            query = query.bind(s);
        }
    }

    let existing: Option<SqliteRow> = query
        .fetch_optional(tx.as_mut())
        .await
        .map_err(ExecutionError::Database)?;

    if let Some(existing_row) = existing {
        let deleted: Option<i64> = existing_row
            .try_get::<Option<i64>, _>("deleted_at")
            .unwrap_or(None);
        if deleted.is_some() {
            inserter.insert(tx, row).await?;
            summary.updates += 1;
            return Ok(());
        }
        let live_updated: Option<i64> = existing_row
            .try_get::<Option<i64>, _>("updated_at")
            .unwrap_or(None);
        match (bundle_updated, live_updated) {
            (Some(bundle_ts), Some(live_ts)) => {
                if bundle_ts > live_ts {
                    inserter.insert(tx, row).await?;
                    summary.updates += 1;
                } else if bundle_ts < live_ts {
                    summary.skips += 1;
                    summary.conflicts.push(TableConflict {
                        table: logical_table.to_string(),
                        id: id.to_string(),
                        bundle_updated_at: Some(bundle_ts),
                        live_updated_at: Some(live_ts),
                    });
                } else {
                    summary.skips += 1;
                }
            }
            (Some(_), None) => {
                inserter.insert(tx, row).await?;
                summary.updates += 1;
            }
            (None, Some(live_ts)) => {
                summary.skips += 1;
                summary.conflicts.push(TableConflict {
                    table: logical_table.to_string(),
                    id: id.to_string(),
                    bundle_updated_at: bundle_updated,
                    live_updated_at: Some(live_ts),
                });
            }
            (None, None) => {
                inserter.insert(tx, row).await?;
                summary.updates += 1;
            }
        }
    } else {
        inserter.insert(tx, row).await?;
        summary.adds += 1;
    }
    Ok(())
}

fn verify_table_summary(
    logical: &str,
    expected: &TablePlan,
    actual: &TableExecutionSummary,
) -> Result<(), ExecutionError> {
    if expected.adds != actual.adds {
        return Err(ExecutionError::PlanDrift {
            table: logical.to_string(),
            field: "adds",
            expected: expected.adds,
            actual: actual.adds,
        });
    }
    if expected.updates != actual.updates {
        return Err(ExecutionError::PlanDrift {
            table: logical.to_string(),
            field: "updates",
            expected: expected.updates,
            actual: actual.updates,
        });
    }
    if expected.skips != actual.skips {
        return Err(ExecutionError::PlanDrift {
            table: logical.to_string(),
            field: "skips",
            expected: expected.skips,
            actual: actual.skips,
        });
    }
    if expected.conflicts != actual.conflicts {
        return Err(ExecutionError::PlanConflictMismatch {
            table: logical.to_string(),
        });
    }
    Ok(())
}

fn execute_attachments_replace(
    bundle: &ImportBundle,
    expected: &super::plan::AttachmentsPlan,
    ctx: &ExecutionContext<'_>,
) -> Result<AttachmentExecutionSummary, ExecutionError> {
    if ctx.clear_attachments_on_replace {
        if ctx.attachments_root.exists() {
            fs::remove_dir_all(ctx.attachments_root).map_err(|err| {
                ExecutionError::AttachmentIo {
                    path: ctx.attachments_root.display().to_string(),
                    source: err.into(),
                }
            })?;
        }
    }
    fs::create_dir_all(ctx.attachments_root).map_err(|err| ExecutionError::AttachmentIo {
        path: ctx.attachments_root.display().to_string(),
        source: err.into(),
    })?;

    let mut summary = AttachmentExecutionSummary::default();
    for attachment in bundle.attachments() {
        copy_attachment(bundle, attachment, ctx.attachments_root)?;
        summary.adds += 1;
    }

    verify_attachment_summary(expected, &summary)?;
    Ok(summary)
}

async fn execute_attachments_merge(
    bundle: &ImportBundle,
    expected: &super::plan::AttachmentsPlan,
    ctx: &ExecutionContext<'_>,
) -> Result<AttachmentExecutionSummary, ExecutionError> {
    let mut summary = AttachmentExecutionSummary::default();
    let bundle_updated_index = collect_bundle_attachment_updates(bundle)?;
    for attachment in bundle.attachments() {
        ensure_safe_relative_path(&attachment.relative_path)?;
        let dest = ctx.attachments_root.join(&attachment.relative_path);
        let bundle_updated_at = bundle_updated_index.get(&attachment.relative_path).copied();
        let live_updated_at =
            load_live_attachment_updated_at(ctx.pool, &attachment.relative_path).await?;
        if !dest.exists() {
            copy_attachment(bundle, attachment, ctx.attachments_root)?;
            summary.adds += 1;
            continue;
        }
        let existing_hash = file_sha256(&dest).map_err(|err| ExecutionError::AttachmentIo {
            path: dest.display().to_string(),
            source: err,
        })?;
        if existing_hash == attachment.sha256 {
            summary.skips += 1;
            continue;
        }

        match decide_attachment_action(bundle_updated_at, live_updated_at) {
            AttachmentAction::BundleWins { reason } => {
                copy_attachment(bundle, attachment, ctx.attachments_root)?;
                summary.updates += 1;
                summary.conflicts.push(AttachmentConflict {
                    relative_path: attachment.relative_path.clone(),
                    bundle_updated_at,
                    live_updated_at,
                    reason,
                });
            }
            AttachmentAction::LiveWins { reason } => {
                summary.skips += 1;
                summary.conflicts.push(AttachmentConflict {
                    relative_path: attachment.relative_path.clone(),
                    bundle_updated_at,
                    live_updated_at,
                    reason,
                });
            }
        }
    }

    verify_attachment_summary(expected, &summary)?;
    Ok(summary)
}

fn verify_attachment_summary(
    expected: &super::plan::AttachmentsPlan,
    actual: &AttachmentExecutionSummary,
) -> Result<(), ExecutionError> {
    if expected.adds != actual.adds {
        return Err(ExecutionError::AttachmentPlanDrift {
            field: "adds",
            expected: expected.adds,
            actual: actual.adds,
        });
    }
    if expected.updates != actual.updates {
        return Err(ExecutionError::AttachmentPlanDrift {
            field: "updates",
            expected: expected.updates,
            actual: actual.updates,
        });
    }
    if expected.skips != actual.skips {
        return Err(ExecutionError::AttachmentPlanDrift {
            field: "skips",
            expected: expected.skips,
            actual: actual.skips,
        });
    }
    if expected.conflicts != actual.conflicts {
        return Err(ExecutionError::AttachmentConflictMismatch);
    }
    Ok(())
}

fn copy_attachment(
    bundle: &ImportBundle,
    attachment: &AttachmentEntry,
    dest_root: &Path,
) -> Result<(), ExecutionError> {
    ensure_safe_relative_path(&attachment.relative_path)?;
    let source = bundle.attachments_dir().join(&attachment.relative_path);
    let dest = dest_root.join(&attachment.relative_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| ExecutionError::AttachmentIo {
            path: parent.display().to_string(),
            source: err.into(),
        })?;
    }
    fs::copy(&source, &dest).map_err(|err| ExecutionError::AttachmentIo {
        path: dest.display().to_string(),
        source: err.into(),
    })?;
    let copied_hash = file_sha256(&dest).map_err(|err| ExecutionError::AttachmentIo {
        path: dest.display().to_string(),
        source: err,
    })?;
    if copied_hash != attachment.sha256 {
        return Err(ExecutionError::AttachmentHashMismatch {
            path: dest.display().to_string(),
        });
    }
    Ok(())
}

fn collect_bundle_attachment_updates(
    bundle: &ImportBundle,
) -> Result<HashMap<String, i64>, ExecutionError> {
    let mut map = HashMap::new();
    for entry in bundle.data_files() {
        if !ATTACHMENT_TABLES
            .iter()
            .any(|table| *table == entry.logical_name.as_str())
        {
            continue;
        }

        let file = File::open(&entry.path).map_err(|err| ExecutionError::DataFileIo {
            path: entry.path.display().to_string(),
            source: err,
        })?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|err| ExecutionError::DataFileIo {
                path: entry.path.display().to_string(),
                source: err,
            })?;
            if line.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&line).map_err(|err| ExecutionError::DataFileParse {
                    path: entry.path.display().to_string(),
                    source: err,
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
) -> Result<Option<i64>, ExecutionError> {
    let mut max_ts: Option<i64> = None;
    let mut conn = pool.acquire().await.map_err(ExecutionError::Database)?;
    for table in ATTACHMENT_TABLES {
        let sql = format!(
            "SELECT MAX(updated_at) FROM {table} WHERE root_key = 'attachments' AND relative_path = ?1 AND deleted_at IS NULL"
        );
        let ts: Option<i64> = match sqlx::query_scalar(&sql)
            .bind(rel)
            .fetch_one(conn.as_mut())
            .await
        {
            Ok(value) => value,
            Err(sqlx::Error::Database(db_err))
                if db_err.code().map_or(false, |code| code == "SQLITE_ERROR")
                    && db_err.message().contains("no such table") =>
            {
                continue;
            }
            Err(err) => return Err(ExecutionError::Database(err)),
        };
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

#[derive(Debug)]
struct TableInserter {
    table: String,
    sql: String,
}

impl TableInserter {
    fn prepare(table: &str, row: &serde_json::Map<String, Value>) -> Result<Self, ExecutionError> {
        let table_ident = quote_ident(table);
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for key in row.keys() {
            let column = quote_ident(key);
            columns.push(column);
            values.push(json_extract_for_column(key));
        }
        let sql = format!(
            "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
            table_ident,
            columns.join(", "),
            values.join(", ")
        );
        Ok(Self {
            table: table.to_string(),
            sql,
        })
    }

    async fn insert(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        row: &Value,
    ) -> Result<(), ExecutionError> {
        let payload = serde_json::to_string(row).map_err(|err| ExecutionError::DataFileParse {
            path: self.table.clone(),
            source: err,
        })?;
        sqlx::query(&self.sql)
            .bind(payload)
            .execute(tx.as_mut())
            .await
            .map_err(ExecutionError::Database)?;
        Ok(())
    }
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

fn extract_id(table: &str, row: &Value) -> Result<IdValue, ExecutionError> {
    let id = row.get("id").ok_or_else(|| ExecutionError::MissingField {
        table: table.to_string(),
        field: "id".to_string(),
    })?;
    if let Some(v) = id.as_i64() {
        return Ok(IdValue::Int(v));
    }
    if let Some(s) = id.as_str() {
        return Ok(IdValue::String(s.to_string()));
    }
    Err(ExecutionError::MissingField {
        table: table.to_string(),
        field: "id".to_string(),
    })
}

fn resolve_physical_table(logical: &str) -> Result<&'static str, ExecutionError> {
    match logical {
        "household" | "households" => Ok("household"),
        "events" => Ok("events"),
        "notes" => Ok("notes"),
        "files" | "files_index" => Ok("files_index"),
        "bills" => Ok("bills"),
        "policies" => Ok("policies"),
        "property_documents" => Ok("property_documents"),
        "inventory_items" => Ok("inventory_items"),
        "vehicle_maintenance" => Ok("vehicle_maintenance"),
        "pet_medical" => Ok("pet_medical"),
        other => Err(ExecutionError::UnknownTable(other.to_string())),
    }
}

fn ensure_safe_relative_path(rel: &str) -> Result<(), ExecutionError> {
    let path = Path::new(rel);
    if path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(ExecutionError::AttachmentPathTraversal(rel.to_string()));
    }
    Ok(())
}

fn quote_ident(name: &str) -> String {
    let escaped = name.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn json_extract_for_column(column: &str) -> String {
    let escaped = column.replace("\\", "\\\\");
    let escaped = escaped.replace('"', "\\\"");
    format!("json_extract(?1, '$.\"{}\"')", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::plan::{build_plan, ImportMode, PlanContext};
    use serde_json::json;
    use sqlx::sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
    };
    use tempfile::TempDir;

    async fn setup_pool() -> (TempDir, SqlitePool) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.sqlite3");
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("create sqlite pool");

        crate::migrate::apply_migrations(&pool)
            .await
            .expect("apply migrations");

        (dir, pool)
    }

    fn write_bundle(
        root: &Path,
        logical: &str,
        rows: &[Value],
        attachments: &[(String, Vec<u8>)],
    ) -> ImportBundle {
        write_bundle_with_tables(root, &[(logical, rows.to_vec())], attachments)
    }

    fn write_bundle_with_tables(
        root: &Path,
        tables: &[(&str, Vec<Value>)],
        attachments: &[(String, Vec<u8>)],
    ) -> ImportBundle {
        use std::io::Write;

        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::create_dir_all(root.join("attachments")).unwrap();

        let attachments_manifest_path = root.join("attachments_manifest.txt");
        let mut manifest_file = std::fs::File::create(&attachments_manifest_path).unwrap();
        for (rel, bytes) in attachments {
            let dest = root.join("attachments").join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&dest, bytes).unwrap();
            let hash = file_sha256(&dest).unwrap();
            writeln!(manifest_file, "{}\t{}", rel, hash).unwrap();
        }
        manifest_file.flush().unwrap();
        drop(manifest_file);
        let attachments_manifest_sha = file_sha256(&attachments_manifest_path).unwrap();

        let mut table_infos = serde_json::Map::new();
        for (logical, rows) in tables {
            let data_path = root.join("data").join(format!("{}.jsonl", logical));
            let mut file = std::fs::File::create(&data_path).unwrap();
            for row in rows {
                serde_json::to_writer(&mut file, row).unwrap();
                file.write_all(b"\n").unwrap();
            }
            file.flush().unwrap();
            drop(file);
            let data_sha = file_sha256(&data_path).unwrap();
            table_infos.insert(
                (*logical).to_string(),
                json!({"count": rows.len() as u64, "sha256": data_sha}),
            );
        }

        let manifest = json!({
            "appVersion": "1.0.0",
            "schemaVersion": "20240101000000",
            "createdAt": "2024-01-01T00:00:00Z",
            "tables": table_infos,
            "attachments": {
                "totalCount": attachments.len() as u64,
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

    fn household_row(id: &str, name: &str, updated_at: i64) -> Value {
        json!({
            "id": id,
            "name": name,
            "created_at": updated_at,
            "updated_at": updated_at,
            "deleted_at": null,
            "tz": "UTC",
        })
    }

    async fn insert_household(pool: &SqlitePool, id: &str, name: &str, updated_at: i64) {
        sqlx::query(
            "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
        )
        .bind(id)
        .bind(name)
        .bind(updated_at)
        .bind(updated_at)
        .bind("UTC")
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn replace_execution_inserts_rows_and_clears_existing() {
        let (_db_dir, pool) = setup_pool().await;
        insert_household(&pool, "hh_old", "Old Household", 10).await;
        let tmp = TempDir::new().unwrap();
        let rows = vec![
            household_row("hh_new", "New Household", 20),
            household_row("hh_other", "Other Household", 30),
        ];
        let bundle = write_bundle(tmp.path(), "household", &rows, &[]);
        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Replace)
            .await
            .unwrap();

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();

        let rows: Vec<(String, i64)> =
            sqlx::query_as("SELECT id, updated_at FROM household ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], ("hh_new".to_string(), 20));
        assert_eq!(rows[1], ("hh_other".to_string(), 30));
        let summary = report.tables.get("household").unwrap();
        assert_eq!(summary.adds, 2);
        assert_eq!(summary.updates, 0);
        assert_eq!(summary.skips, 0);
    }

    #[tokio::test]
    async fn merge_execution_updates_and_skips_consistently() {
        let (_db_dir, pool) = setup_pool().await;
        insert_household(&pool, "hh_keep", "Keep", 200).await;
        insert_household(&pool, "hh_update", "Update", 150).await;
        let tmp = TempDir::new().unwrap();
        let rows = vec![
            household_row("hh_keep", "Keep", 180),
            household_row("hh_update", "Updated", 220),
            household_row("hh_new", "New", 50),
        ];
        let bundle = write_bundle(tmp.path(), "household", &rows, &[]);
        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Merge)
            .await
            .unwrap();

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();
        let summary = report.tables.get("household").unwrap();
        assert_eq!(summary.adds, 1);
        assert_eq!(summary.updates, 1);
        assert_eq!(summary.skips, 1);
        assert_eq!(summary.conflicts.len(), 1);

        let existing: Vec<(String, i64)> =
            sqlx::query_as("SELECT id, updated_at FROM household ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        let keep = existing.iter().find(|(id, _)| id == "hh_keep").unwrap();
        assert_eq!(keep.1, 200);
        let update = existing.iter().find(|(id, _)| id == "hh_update").unwrap();
        assert_eq!(update.1, 220);
    }

    #[tokio::test]
    async fn camelcase_rows_round_trip_without_fk_errors() {
        let (_db_dir, pool) = setup_pool().await;
        let tmp = TempDir::new().unwrap();
        let bundle = write_bundle_with_tables(
            tmp.path(),
            &[
                (
                    "household",
                    vec![json!({
                        "id": "hh1",
                        "name": "Primary",
                        "timeZone": "UTC",
                        "createdAt": 1,
                        "updatedAt": 2,
                        "deletedAt": null
                    })],
                ),
                (
                    "events",
                    vec![json!({
                        "id": "evt1",
                        "title": "Event",
                        "householdId": "hh1",
                        "startAtUtc": 3,
                        "endAtUtc": 4,
                        "createdAt": 5,
                        "updatedAt": 6,
                        "deletedAt": null,
                        "timeZone": "UTC"
                    })],
                ),
                (
                    "notes",
                    vec![json!({
                        "id": "note1",
                        "householdId": "hh1",
                        "position": 1,
                        "z": 0,
                        "createdAt": 7,
                        "updatedAt": 8,
                        "deletedAt": null
                    })],
                ),
            ],
            &[],
        );

        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Replace)
            .await
            .unwrap();

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();

        let fk_violations: Vec<(String, i64, String, i64)> =
            sqlx::query_as("PRAGMA foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(fk_violations.is_empty());

        let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(event_count, 1);

        let note_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(note_count, 1);

        let household_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM household")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(household_count, 1);

        assert_eq!(report.tables.get("events").unwrap().adds, 1);
        assert_eq!(report.tables.get("notes").unwrap().adds, 1);
        assert_eq!(report.tables.get("household").unwrap().adds, 1);
    }

    #[tokio::test]
    async fn attachments_replace_overwrites_destination() {
        let (_db_dir, pool) = setup_pool().await;
        let tmp = TempDir::new().unwrap();
        let rows = vec![household_row("hh_attach", "Has Attachment", 10)];
        let attachments = vec![("docs/file.txt".to_string(), b"bundle".to_vec())];
        let bundle = write_bundle(tmp.path(), "household", &rows, &attachments);
        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Replace)
            .await
            .unwrap();

        let existing_path = attachments_root.path().join("docs/file.txt");
        std::fs::create_dir_all(existing_path.parent().unwrap()).unwrap();
        std::fs::write(&existing_path, b"old").unwrap();

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();
        assert_eq!(report.attachments.adds, 1);
        let contents = std::fs::read(&existing_path).unwrap();
        assert_eq!(contents, b"bundle");
    }

    #[tokio::test]
    async fn attachments_merge_overwrites_when_bundle_newer() {
        let (_db_dir, pool) = setup_pool().await;
        insert_household(&pool, "hh1", "Home", 100).await;
        sqlx::query("INSERT INTO bills (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, NULL, 0, 'attachments', ?7)")
            .bind("bill1")
            .bind(100_i64)
            .bind(0_i64)
            .bind("hh1")
            .bind(100_i64)
            .bind(150_i64)
            .bind("docs/file.txt")
            .execute(&pool)
            .await
            .unwrap();

        let tmp = TempDir::new().unwrap();
        let rows = vec![json!({
            "id": "bill1",
            "amount": 100,
            "due_date": 0,
            "household_id": "hh1",
            "created_at": 100,
            "updated_at": 300,
            "deleted_at": null,
            "root_key": "attachments",
            "relative_path": "docs/file.txt",
        })];
        let attachments = vec![("docs/file.txt".to_string(), b"bundle".to_vec())];
        let bundle = write_bundle(tmp.path(), "bills", &rows, &attachments);
        let attachments_root = TempDir::new().unwrap();
        let existing_path = attachments_root.path().join("docs/file.txt");
        std::fs::create_dir_all(existing_path.parent().unwrap()).unwrap();
        std::fs::write(&existing_path, b"local").unwrap();

        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Merge)
            .await
            .unwrap();
        assert_eq!(plan.attachments.updates, 1);
        assert_eq!(plan.attachments.skips, 0);
        assert_eq!(plan.attachments.conflicts.len(), 1);
        assert!(plan.attachments.conflicts[0]
            .reason
            .contains("bundle newer"));

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();
        assert_eq!(report.attachments.updates, 1);
        assert_eq!(report.attachments.skips, 0);
        assert_eq!(report.attachments.conflicts, plan.attachments.conflicts);
        let contents = std::fs::read(&existing_path).unwrap();
        assert_eq!(contents, b"bundle");
    }

    #[tokio::test]
    async fn attachments_merge_skips_when_live_newer() {
        let (_db_dir, pool) = setup_pool().await;
        insert_household(&pool, "hh1", "Home", 100).await;
        sqlx::query("INSERT INTO bills (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, NULL, 0, 'attachments', ?7)")
            .bind("bill2")
            .bind(100_i64)
            .bind(0_i64)
            .bind("hh1")
            .bind(100_i64)
            .bind(350_i64)
            .bind("docs/file.txt")
            .execute(&pool)
            .await
            .unwrap();

        let tmp = TempDir::new().unwrap();
        let rows = vec![json!({
            "id": "bill2",
            "amount": 100,
            "due_date": 0,
            "household_id": "hh1",
            "created_at": 100,
            "updated_at": 200,
            "deleted_at": null,
            "root_key": "attachments",
            "relative_path": "docs/file.txt",
        })];
        let attachments = vec![("docs/file.txt".to_string(), b"bundle".to_vec())];
        let bundle = write_bundle(tmp.path(), "bills", &rows, &attachments);
        let attachments_root = TempDir::new().unwrap();
        let existing_path = attachments_root.path().join("docs/file.txt");
        std::fs::create_dir_all(existing_path.parent().unwrap()).unwrap();
        std::fs::write(&existing_path, b"local").unwrap();

        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Merge)
            .await
            .unwrap();
        assert_eq!(plan.attachments.updates, 0);
        assert_eq!(plan.attachments.skips, 1);
        assert_eq!(plan.attachments.conflicts.len(), 1);
        assert!(plan.attachments.conflicts[0].reason.contains("local newer"));

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();
        assert_eq!(report.attachments.updates, 0);
        assert_eq!(report.attachments.skips, 1);
        assert_eq!(report.attachments.conflicts, plan.attachments.conflicts);
        let contents = std::fs::read(&existing_path).unwrap();
        assert_eq!(contents, b"local");
    }

    #[tokio::test]
    async fn replace_rebuilds_schema_and_removes_extra_tables() {
        let (_db_dir, pool) = setup_pool().await;
        insert_household(&pool, "hh_old", "Old", 5).await;
        sqlx::query("CREATE TABLE scratch (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO scratch (id) VALUES (1)")
            .execute(&pool)
            .await
            .unwrap();

        let tmp = TempDir::new().unwrap();
        let rows = vec![household_row("hh_new", "Restored", 42)];
        let bundle = write_bundle(tmp.path(), "household", &rows, &[]);
        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let plan = build_plan(&bundle, &plan_ctx, ImportMode::Replace)
            .await
            .unwrap();

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let report = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap();

        let households: Vec<(String, i64)> =
            sqlx::query_as("SELECT id, updated_at FROM household ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(households, vec![("hh_new".to_string(), 42)]);

        let scratch_exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scratch'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(scratch_exists.is_none());

        let migration_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(migration_count > 0);

        let summary = report.tables.get("household").unwrap();
        assert_eq!(summary.adds, 1);
        assert_eq!(summary.updates, 0);
        assert_eq!(summary.skips, 0);
    }

    #[tokio::test]
    async fn plan_drift_in_tables_is_detected() {
        let (_db_dir, pool) = setup_pool().await;
        let tmp = TempDir::new().unwrap();
        let rows = vec![household_row("hh", "One", 10)];
        let bundle = write_bundle(tmp.path(), "household", &rows, &[]);
        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let mut plan = build_plan(&bundle, &plan_ctx, ImportMode::Replace)
            .await
            .unwrap();

        let household = plan.tables.get_mut("household").unwrap();
        household.adds += 1;

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let err = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap_err();
        matches!(err, ExecutionError::PlanDrift { table, field, .. } if table == "household" && field == "adds")
            .then_some(())
            .unwrap();
    }

    #[tokio::test]
    async fn plan_drift_in_attachments_is_detected() {
        let (_db_dir, pool) = setup_pool().await;
        let tmp = TempDir::new().unwrap();
        let rows = vec![household_row("hh_attach", "Attach", 1)];
        let attachments = vec![("docs/file.txt".to_string(), b"bundle".to_vec())];
        let bundle = write_bundle(tmp.path(), "household", &rows, &attachments);
        let attachments_root = TempDir::new().unwrap();
        let plan_ctx = PlanContext {
            pool: &pool,
            attachments_root: attachments_root.path(),
        };
        let mut plan = build_plan(&bundle, &plan_ctx, ImportMode::Replace)
            .await
            .unwrap();

        plan.attachments.adds += 1;

        let exec_ctx = ExecutionContext::new(&pool, attachments_root.path());
        let err = execute_plan(&bundle, &plan, &exec_ctx).await.unwrap_err();
        matches!(err, ExecutionError::AttachmentPlanDrift { field, .. } if field == "adds")
            .then_some(())
            .unwrap();
    }
}
