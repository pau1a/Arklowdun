use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::types::{FromSql, Value};
use rusqlite::{params_from_iter, Connection, Error as SqliteError, OpenFlags, Row, Transaction};
use serde::Serialize;
use tokio::task;
use ts_rs::TS;

use crate::{AppError, AppResult};

use super::{schema_rebuild, swap};

const HARD_REPAIR_PREFIX: &str = "hard-repair";
const HARD_REPAIR_PRE_PREFIX: &str = "hard-repair-pre";
const BACKUPS_DIR: &str = "backups";
const NEW_DB_NAME: &str = "new.sqlite3";
const ARCHIVE_DB_NAME: &str = "pre-hard-repair.sqlite3";
const SKIP_SAMPLE_LIMIT: usize = 25;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HardRepairTableStats {
    #[ts(type = "number")]
    pub attempted: u64,
    #[ts(type = "number")]
    pub succeeded: u64,
    #[ts(type = "number")]
    pub failed: u64,
}

impl HardRepairTableStats {
    fn new() -> Self {
        Self {
            attempted: 0,
            succeeded: 0,
            failed: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HardRepairSkippedRow {
    pub table: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number | null")]
    pub rowid: Option<i64>,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HardRepairRecoveryReport {
    pub app_version: String,
    pub tables: BTreeMap<String, HardRepairTableStats>,
    pub skipped_examples: Vec<HardRepairSkippedRow>,
    #[ts(type = "string")]
    pub completed_at: DateTime<Utc>,
    #[serde(default)]
    pub integrity_ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub integrity_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub foreign_key_errors: Option<Vec<HardRepairSkippedRow>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HardRepairOutcome {
    pub success: bool,
    pub omitted: bool,
    pub report_path: String,
    pub pre_backup_directory: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub archived_db_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rebuilt_db_path: Option<String>,
    pub recovery: HardRepairRecoveryReport,
}

#[derive(Default)]
struct TransferContext {
    skipped: Vec<HardRepairSkippedRow>,
}

fn backup_root(db_path: &Path) -> AppResult<PathBuf> {
    let parent = db_path.parent().ok_or_else(|| {
        AppError::new(
            "DB_HARD_REPAIR/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", db_path.display().to_string())
    })?;
    Ok(parent.join(BACKUPS_DIR))
}

fn copy_with_sidecars(src: &Path, dest: &Path) -> AppResult<()> {
    fs::copy(src, dest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "copy_database")
            .with_context("from", src.display().to_string())
            .with_context("to", dest.display().to_string())
    })?;

    const SIDECARS: [&str; 2] = ["-wal", "-shm"];
    for suffix in SIDECARS {
        let mut from_os = OsString::from(src.as_os_str());
        from_os.push(suffix);
        let from = PathBuf::from(&from_os);
        if from.exists() {
            let mut to_os = OsString::from(dest.as_os_str());
            to_os.push(suffix);
            let to = PathBuf::from(&to_os);
            fs::copy(&from, &to).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "copy_database_sidecar")
                    .with_context("from", from.display().to_string())
                    .with_context("to", to.display().to_string())
            })?;
        }
    }

    Ok(())
}

fn unique_timestamp_dir(
    root: &Path,
    prefix: &str,
    timestamp: &DateTime<Utc>,
) -> AppResult<PathBuf> {
    let base = timestamp.format("%Y%m%d-%H%M%S").to_string();
    for suffix in 0..100 {
        let candidate = if suffix == 0 {
            root.join(format!("{prefix}-{base}"))
        } else {
            root.join(format!("{prefix}-{base}-{suffix:02}"))
        };
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(AppError::new(
        "DB_HARD_REPAIR/NAME_COLLISION",
        "Unable to allocate hard repair directory",
    ))
}

fn quote_ident(name: &str) -> String {
    let escaped = name.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn list_tables(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .map_err(|err| AppError::from(err).with_context("operation", "list_tables"))?;
    let tables = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let sql: Option<String> = row.get(1)?;
            Ok((name, sql))
        })
        .map_err(|err| AppError::from(err).with_context("operation", "list_tables_query"))?
        .filter_map(|row| match row {
            Ok((name, sql)) => match sql.as_deref() {
                None => None,
                Some(ddl) => {
                    let is_virtual = ddl
                        .trim_start()
                        .to_uppercase()
                        .starts_with("CREATE VIRTUAL TABLE");
                    if is_virtual {
                        None
                    } else {
                        Some(Ok(name))
                    }
                }
            },
            Err(err) => Some(Err(err)),
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| AppError::from(err).with_context("operation", "collect_tables"))?;
    Ok(tables)
}

fn fk_dependencies(
    conn: &Connection,
    tables: &[String],
) -> AppResult<HashMap<String, BTreeSet<String>>> {
    let mut deps = HashMap::new();
    let table_set: BTreeSet<_> = tables.iter().cloned().collect();
    for table in tables {
        let mut stmt = conn
            .prepare(&format!("PRAGMA foreign_key_list({})", quote_ident(table)))
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "foreign_key_list")
                    .with_context("table", table.clone())
            })?;
        let mut rows = stmt
            .query([])
            .map_err(|err| AppError::from(err).with_context("operation", "foreign_key_query"))?;
        let mut set = BTreeSet::new();
        while let Some(row) = rows.next().map_err(|err| {
            AppError::from(err)
                .with_context("operation", "foreign_key_iter")
                .with_context("table", table.clone())
        })? {
            let target: String = row.get::<_, String>(2).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "foreign_key_target")
                    .with_context("table", table.clone())
            })?;
            if table_set.contains(&target) && target != *table {
                set.insert(target);
            }
        }
        deps.insert(table.clone(), set);
    }
    Ok(deps)
}

fn topo_order(tables: Vec<String>, deps: &HashMap<String, BTreeSet<String>>) -> Vec<String> {
    let mut incoming: HashMap<String, usize> = tables
        .iter()
        .map(|table| {
            let count = deps.get(table).map(|set| set.len()).unwrap_or(0);
            (table.clone(), count)
        })
        .collect();
    let mut dependents: HashMap<String, BTreeSet<String>> = HashMap::new();

    for (table, sources) in deps {
        for dep in sources {
            if incoming.contains_key(dep) {
                dependents
                    .entry(dep.clone())
                    .or_default()
                    .insert(table.clone());
            }
        }
    }

    let mut zero_incoming: Vec<String> = incoming
        .iter()
        .filter(|(_, &count)| count == 0)
        .map(|(table, _)| table.clone())
        .collect();
    zero_incoming.sort();
    let mut queue: VecDeque<String> = zero_incoming.into_iter().collect();
    let mut visited = BTreeSet::new();
    let mut order = Vec::new();

    while let Some(next) = queue.pop_front() {
        if !visited.insert(next.clone()) {
            continue;
        }
        order.push(next.clone());
        if let Some(children) = dependents.get(&next) {
            for child in children {
                if let Some(count) = incoming.get_mut(child) {
                    if *count > 0 {
                        *count -= 1;
                        if *count == 0 {
                            queue.push_back(child.clone());
                        }
                    }
                }
            }
        }
    }

    let mut remaining: Vec<String> = incoming
        .into_iter()
        .filter_map(|(table, count)| {
            if visited.contains(&table) {
                None
            } else {
                Some((table, count))
            }
        })
        .map(|(table, _)| table)
        .collect();
    remaining.sort();
    order.extend(remaining);
    order
}

fn optional_column<T: FromSql>(row: &Row<'_>, name: &str) -> rusqlite::Result<Option<T>> {
    match row.as_ref().column_index(name) {
        Ok(idx) => row.get(idx).map(Some),
        Err(SqliteError::InvalidColumnName(_)) => Ok(None),
        Err(err) => Err(err),
    }
}

fn table_columns(conn: &Connection, table: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_xinfo({})", quote_ident(table)))
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "table_info")
                .with_context("table", table.to_string())
        })?;
    let mut rows = stmt
        .query([])
        .map_err(|err| AppError::from(err).with_context("operation", "table_info_query"))?;
    let mut cols = Vec::new();
    while let Some(row) = rows.next().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "table_info_iter")
            .with_context("table", table.to_string())
    })? {
        let hidden: i64 = optional_column::<i64>(&row, "hidden")?.unwrap_or(0);
        if hidden != 0 {
            continue;
        }
        if optional_column::<String>(&row, "generated")?
            .map(|g| !g.is_empty())
            .unwrap_or(false)
        {
            continue;
        }
        let name: String = row.get(1).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "table_info_name")
                .with_context("table", table.to_string())
        })?;
        cols.push(name);
    }
    Ok(cols)
}

fn build_select_sql(table: &str, columns: &[String], include_rowid: bool) -> String {
    let mut select_cols = Vec::with_capacity(columns.len() + if include_rowid { 1 } else { 0 });
    if include_rowid {
        select_cols.push("rowid".to_string());
    }
    select_cols.extend(columns.iter().map(|col| quote_ident(col)));
    format!(
        "SELECT {} FROM {}",
        select_cols.join(", "),
        quote_ident(table)
    )
}

fn build_insert_sql(table: &str, columns: &[String]) -> String {
    let placeholders: Vec<String> = columns
        .iter()
        .enumerate()
        .map(|(idx, _)| format!("?{}", idx + 1))
        .collect();
    format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote_ident(table),
        columns
            .iter()
            .map(|c| quote_ident(c))
            .collect::<Vec<_>>()
            .join(", "),
        placeholders.join(", "),
    )
}

fn extract_values(start_index: usize, count: usize, row: &Row<'_>) -> AppResult<Vec<Value>> {
    let mut values = Vec::with_capacity(count);
    for idx in 0..count {
        let value: Value = row.get(idx + start_index).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "read_value")
                .with_context("column_index", (idx + start_index).to_string())
        })?;
        values.push(value);
    }
    Ok(values)
}

fn transfer_table(
    src: &Connection,
    tx: &Transaction<'_>,
    table: &str,
    columns: &[String],
    insert_sql: &str,
    ctx: &mut TransferContext,
) -> AppResult<HardRepairTableStats> {
    let mut stats = HardRepairTableStats::new();
    let (mut stmt, has_rowid) = match src.prepare(&build_select_sql(table, columns, true)) {
        Ok(stmt) => (stmt, true),
        Err(err) => {
            let message = err.to_string();
            if message.contains("no such column: rowid") {
                let stmt = src
                    .prepare(&build_select_sql(table, columns, false))
                    .map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "prepare_select")
                            .with_context("table", table.to_string())
                    })?;
                (stmt, false)
            } else {
                return Err(AppError::from(err)
                    .with_context("operation", "prepare_select")
                    .with_context("table", table.to_string()));
            }
        }
    };
    let mut rows = stmt
        .query([])
        .map_err(|err| AppError::from(err).with_context("operation", "query_select"))?;

    let mut insert = tx.prepare_cached(insert_sql).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "prepare_insert")
            .with_context("table", table.to_string())
    })?;

    while let Some(row) = rows.next().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "select_iter")
            .with_context("table", table.to_string())
    })? {
        stats.attempted += 1;
        let rowid = if has_rowid {
            row.get::<_, Option<i64>>(0).ok().flatten()
        } else {
            None
        };
        let start_index = if has_rowid { 1 } else { 0 };
        let values = extract_values(start_index, columns.len(), &row)?;
        match insert.execute(params_from_iter(values.iter())) {
            Ok(_) => {
                stats.succeeded += 1;
            }
            Err(err) => {
                stats.failed += 1;
                if ctx.skipped.len() < SKIP_SAMPLE_LIMIT {
                    ctx.skipped.push(HardRepairSkippedRow {
                        table: table.to_string(),
                        rowid,
                        error: err.to_string(),
                    });
                }
            }
        }
    }

    Ok(stats)
}

fn run_integrity_checks(
    conn: &Connection,
) -> (bool, Option<String>, Option<Vec<HardRepairSkippedRow>>) {
    let mut integrity_ok = true;
    let mut integrity_error = None;

    match conn.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0)) {
        Ok(value) if value.eq_ignore_ascii_case("ok") => {}
        Ok(value) => {
            integrity_ok = false;
            integrity_error = Some(value);
        }
        Err(err) => {
            integrity_ok = false;
            integrity_error = Some(err.to_string());
        }
    }

    let mut fk_errors = Vec::new();
    let mut stmt = match conn.prepare("PRAGMA foreign_key_check") {
        Ok(stmt) => stmt,
        Err(err) => {
            integrity_ok = false;
            let message = format!("foreign_key_check failed: {err}");
            return (integrity_ok, Some(message), None);
        }
    };

    let mut rows = match stmt.query([]) {
        Ok(rows) => rows,
        Err(err) => {
            integrity_ok = false;
            let message = format!("foreign_key_check failed: {err}");
            return (integrity_ok, Some(message), None);
        }
    };

    while let Ok(Some(row)) = rows.next() {
        let table: String = row.get(0).unwrap_or_default();
        let rowid: Option<i64> = row.get(1).ok().flatten();
        let parent: Option<String> = row.get(2).ok();
        let msg = parent
            .map(|p| format!("references missing {p}"))
            .unwrap_or_else(|| "foreign key violation".to_string());
        fk_errors.push(HardRepairSkippedRow {
            table,
            rowid,
            error: msg,
        });
    }

    if !fk_errors.is_empty() {
        integrity_ok = false;
    }

    (
        integrity_ok,
        integrity_error,
        if fk_errors.is_empty() {
            None
        } else {
            Some(fk_errors)
        },
    )
}

fn run_hard_repair_inner(db_path: PathBuf) -> AppResult<HardRepairOutcome> {
    let timestamp = Utc::now();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let backup_root = backup_root(&db_path)?;
    fs::create_dir_all(&backup_root).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_backups_root")
            .with_context("path", backup_root.display().to_string())
    })?;

    let pre_dir = unique_timestamp_dir(&backup_root, HARD_REPAIR_PRE_PREFIX, &timestamp)?;
    fs::create_dir_all(&pre_dir).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_pre_backup")
            .with_context("path", pre_dir.display().to_string())
    })?;

    let pre_db_path = pre_dir.join("arklowdun.sqlite3");
    copy_with_sidecars(&db_path, &pre_db_path)?;

    let parent = db_path.parent().ok_or_else(|| {
        AppError::new(
            "DB_HARD_REPAIR/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", db_path.display().to_string())
    })?;
    let new_db_path = parent.join(NEW_DB_NAME);
    let archive_path = parent.join(ARCHIVE_DB_NAME);

    schema_rebuild::rebuild_schema(&new_db_path)?;

    let src_conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "open_source_db")
            .with_context("path", db_path.display().to_string())
    })?;
    let mut dest_conn = Connection::open(&new_db_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "open_dest_db")
            .with_context("path", new_db_path.display().to_string())
    })?;
    dest_conn.pragma_update(None, "foreign_keys", 1).ok();
    let defer_supported = dest_conn
        .pragma_update(None, "defer_foreign_keys", 1)
        .is_ok();
    if !defer_supported {
        dest_conn.pragma_update(None, "foreign_keys", 0).ok();
    }

    let tables = list_tables(&src_conn)?;
    let deps = fk_dependencies(&src_conn, &tables)?;
    let order = topo_order(tables.clone(), &deps);

    let mut ctx = TransferContext::default();
    let mut stats = BTreeMap::new();

    let tx = dest_conn.transaction().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "begin_hard_repair_tx")
            .with_context("path", new_db_path.display().to_string())
    })?;

    for table in order {
        let columns = match table_columns(&src_conn, &table) {
            Ok(cols) => cols,
            Err(err) => {
                ctx.skipped.push(HardRepairSkippedRow {
                    table: table.clone(),
                    rowid: None,
                    error: err.to_string(),
                });
                continue;
            }
        };
        if columns.is_empty() {
            continue;
        }

        let insert_sql = build_insert_sql(&table, &columns);
        let table_stats = transfer_table(&src_conn, &tx, &table, &columns, &insert_sql, &mut ctx)?;
        stats.insert(table, table_stats);
    }

    tx.commit().map_err(|err| {
        AppError::from(err)
            .with_context("operation", "commit_hard_repair_tx")
            .with_context("path", new_db_path.display().to_string())
    })?;

    if !defer_supported {
        dest_conn.pragma_update(None, "foreign_keys", 1).ok();
    }

    #[cfg(test)]
    let (mut integrity_ok, mut integrity_error, fk_errors) = run_integrity_checks(&dest_conn);
    #[cfg(not(test))]
    let (integrity_ok, integrity_error, fk_errors) = run_integrity_checks(&dest_conn);

    #[cfg(test)]
    {
        if tests::should_force_integrity_fail() {
            integrity_ok = false;
            if integrity_error.is_none() {
                integrity_error = Some("forced integrity failure for test".to_string());
            }
        }
    }

    dest_conn.flush_prepared_statement_cache();
    dest_conn.close().map_err(|(_, err)| {
        AppError::from(err)
            .with_context("operation", "close_dest_conn")
            .with_context("path", new_db_path.display().to_string())
    })?;
    src_conn.close().map_err(|(_, err)| {
        AppError::from(err)
            .with_context("operation", "close_source_conn")
            .with_context("path", db_path.display().to_string())
    })?;

    let mut archived_db_path = None;
    if integrity_ok {
        #[cfg(test)]
        tests::mark_swap_called();
        swap::swap_database(&db_path, &new_db_path, &archive_path)?;
        archived_db_path = Some(archive_path.to_string_lossy().into_owned());
    }

    let report_dir = unique_timestamp_dir(&backup_root, HARD_REPAIR_PREFIX, &timestamp)?;
    fs::create_dir_all(&report_dir).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_report_dir")
            .with_context("path", report_dir.display().to_string())
    })?;
    let mut rebuilt_db_path = None;
    if !integrity_ok && new_db_path.exists() {
        let preserved = report_dir.join("recovered.sqlite3");
        fs::rename(&new_db_path, &preserved).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "preserve_rebuilt_db")
                .with_context("from", new_db_path.display().to_string())
                .with_context("to", preserved.display().to_string())
        })?;
        rebuilt_db_path = Some(preserved.to_string_lossy().into_owned());
    }
    let report_path = report_dir.join("recovery-report.json");

    let recovery = HardRepairRecoveryReport {
        app_version,
        tables: stats,
        skipped_examples: ctx.skipped.clone(),
        completed_at: Utc::now(),
        integrity_ok,
        integrity_error,
        foreign_key_errors: fk_errors,
    };

    let serialized = serde_json::to_vec_pretty(&recovery).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "serialize_recovery_report")
            .with_context("path", report_path.display().to_string())
    })?;
    crate::db::write_atomic(&report_path, &serialized)?;

    let omitted = !recovery.skipped_examples.is_empty()
        || recovery.tables.values().any(|entry| entry.failed > 0)
        || !recovery.integrity_ok
        || recovery
            .foreign_key_errors
            .as_ref()
            .map(|errors| !errors.is_empty())
            .unwrap_or(false);

    Ok(HardRepairOutcome {
        success: recovery.integrity_ok,
        omitted,
        report_path: report_path.to_string_lossy().into_owned(),
        pre_backup_directory: pre_dir.to_string_lossy().into_owned(),
        archived_db_path,
        rebuilt_db_path,
        recovery,
    })
}

pub async fn run_hard_repair(db_path: &Path) -> AppResult<HardRepairOutcome> {
    let db_path = db_path.to_path_buf();
    let result = task::spawn_blocking(move || run_hard_repair_inner(db_path))
        .await
        .map_err(|err| {
            AppError::new("DB_HARD_REPAIR/JOIN", "Hard repair task panicked")
                .with_context("error", err.to_string())
        })?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::tempdir;

    static FORCE_INTEGRITY_FAIL: AtomicBool = AtomicBool::new(false);
    static SWAP_CALLED: AtomicBool = AtomicBool::new(false);

    pub(super) fn should_force_integrity_fail() -> bool {
        FORCE_INTEGRITY_FAIL.load(Ordering::SeqCst)
    }

    pub(super) fn set_force_integrity_fail(value: bool) {
        FORCE_INTEGRITY_FAIL.store(value, Ordering::SeqCst);
    }

    pub(super) fn mark_swap_called() {
        SWAP_CALLED.store(true, Ordering::SeqCst);
    }

    fn reset_test_state() {
        set_force_integrity_fail(false);
        SWAP_CALLED.store(false, Ordering::SeqCst);
    }

    fn swap_was_called() -> bool {
        SWAP_CALLED.load(Ordering::SeqCst)
    }

    #[test]
    fn topo_order_respects_dependencies() {
        let tables = vec![
            "events".to_string(),
            "households".to_string(),
            "notes".to_string(),
        ];
        let mut deps = HashMap::new();
        deps.insert(
            "events".to_string(),
            BTreeSet::from(["households".to_string()]),
        );
        deps.insert(
            "notes".to_string(),
            BTreeSet::from(["households".to_string()]),
        );
        let order = topo_order(tables.clone(), &deps);
        let idx_events = order.iter().position(|t| t == "events").unwrap();
        let idx_notes = order.iter().position(|t| t == "notes").unwrap();
        let idx_households = order.iter().position(|t| t == "households").unwrap();
        assert!(idx_households < idx_events);
        assert!(idx_households < idx_notes);
    }

    #[test]
    fn topo_order_handles_cycles() {
        let tables = vec!["a".to_string(), "b".to_string()];
        let mut deps = HashMap::new();
        deps.insert("a".to_string(), BTreeSet::from(["b".to_string()]));
        deps.insert("b".to_string(), BTreeSet::from(["a".to_string()]));
        let order = topo_order(tables.clone(), &deps);
        assert_eq!(order.len(), 2);
        assert!(order.contains(&"a".to_string()));
        assert!(order.contains(&"b".to_string()));
    }

    #[test]
    fn transfers_mutual_foreign_keys_with_deferred_constraints() {
        reset_test_state();
        let tmp = tempdir().expect("tempdir");
        let src_path = tmp.path().join("source.sqlite3");
        let dest_path = tmp.path().join("dest.sqlite3");

        let mut src_conn = Connection::open(&src_path).expect("open source");
        src_conn
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE a(id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b(id));
                 CREATE TABLE b(id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));",
            )
            .expect("create schema");
        src_conn.pragma_update(None, "defer_foreign_keys", 1).ok();
        {
            let tx = src_conn.transaction().expect("source tx");
            tx.execute("INSERT INTO a(id, b_id) VALUES (1, 1)", [])
                .expect("insert a");
            tx.execute("INSERT INTO b(id, a_id) VALUES (1, 1)", [])
                .expect("insert b");
            tx.commit().expect("commit source tx");
        }

        let mut dest_conn = Connection::open(&dest_path).expect("open dest");
        dest_conn
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE a(id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b(id));
                 CREATE TABLE b(id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));",
            )
            .expect("dest schema");
        dest_conn.pragma_update(None, "defer_foreign_keys", 1).ok();

        let tables = list_tables(&src_conn).expect("list tables");
        let deps = fk_dependencies(&src_conn, &tables).expect("deps");
        let order = topo_order(tables.clone(), &deps);

        let mut ctx = TransferContext::default();
        let tx = dest_conn.transaction().expect("begin tx");
        for table in order {
            let columns = table_columns(&src_conn, &table).expect("columns");
            if columns.is_empty() {
                continue;
            }
            let insert_sql = build_insert_sql(&table, &columns);
            transfer_table(&src_conn, &tx, &table, &columns, &insert_sql, &mut ctx)
                .expect("transfer table");
        }
        tx.commit().expect("commit");

        let (integrity_ok, _, fk_errors) = run_integrity_checks(&dest_conn);
        assert!(integrity_ok, "integrity check should succeed");
        assert!(fk_errors.unwrap_or_default().is_empty());

        let count_a: i64 = dest_conn
            .query_row("SELECT COUNT(*) FROM a", [], |row| row.get(0))
            .expect("count a");
        let count_b: i64 = dest_conn
            .query_row("SELECT COUNT(*) FROM b", [], |row| row.get(0))
            .expect("count b");
        assert_eq!(count_a, 1);
        assert_eq!(count_b, 1);
    }

    #[test]
    fn hard_repair_skips_swap_when_integrity_fails() {
        reset_test_state();
        let tmp = tempdir().expect("tempdir");
        let db_path = tmp.path().join("arklowdun.sqlite3");
        schema_rebuild::rebuild_schema(&db_path).expect("rebuild schema");

        let conn = Connection::open(&db_path).expect("open conn");
        conn.execute(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["household", "Test", 0i64, 0i64],
        )
        .expect("insert household");
        conn.close().expect("close conn");

        set_force_integrity_fail(true);
        let outcome = run_hard_repair_inner(db_path.clone()).expect("run hard repair");
        set_force_integrity_fail(false);

        assert!(!outcome.success);
        assert!(outcome.archived_db_path.is_none());
        assert!(outcome.rebuilt_db_path.is_some());
        assert!(outcome.omitted);
        assert!(!swap_was_called(), "swap should not be invoked");

        let conn = Connection::open(&db_path).expect("reopen original");
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM household", [], |row| row.get(0))
            .expect("count household");
        assert_eq!(remaining, 1);
    }

    #[test]
    fn hard_repair_transfers_large_table_without_omissions() {
        reset_test_state();
        let tmp = tempdir().expect("tempdir");
        let db_path = tmp.path().join("arklowdun.sqlite3");
        schema_rebuild::rebuild_schema(&db_path).expect("rebuild schema");

        let conn = Connection::open(&db_path).expect("open conn");
        conn.execute(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["household", "Test", 0i64, 0i64],
        )
        .expect("insert household");

        let event_count = 2048u64;
        for idx in 0..event_count {
            let id = format!("event-{idx}");
            conn.execute(
                "INSERT INTO events (
                    id, title, reminder, household_id, created_at, updated_at, deleted_at,
                    tz, start_at_utc, end_at_utc, rrule, exdates
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    id,
                    format!("Event {idx}"),
                    Option::<i64>::None,
                    "household",
                    0i64,
                    0i64,
                    Option::<i64>::None,
                    Option::<String>::None,
                    1_700_000_000i64 + idx as i64,
                    Option::<i64>::None,
                    Option::<String>::None,
                    Option::<String>::None,
                ],
            )
            .expect("insert event");
        }
        conn.close().expect("close conn");

        let outcome = run_hard_repair_inner(db_path.clone()).expect("run hard repair");

        assert!(outcome.success);
        assert!(!outcome.omitted);
        let events_stats = outcome
            .recovery
            .tables
            .get("events")
            .expect("events stats present");
        assert_eq!(events_stats.attempted, event_count);
        assert_eq!(events_stats.succeeded, event_count);
        assert_eq!(events_stats.failed, 0);
        assert!(outcome.archived_db_path.is_some());
        assert!(swap_was_called(), "swap should occur on success");
    }
}
