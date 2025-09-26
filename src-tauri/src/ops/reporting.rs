use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, SecondsFormat, Utc};
use iana_time_zone::get_timezone;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

#[cfg(debug_assertions)]
use jsonschema::JSONSchema;
#[cfg(debug_assertions)]
use once_cell::sync::Lazy;

use crate::db::manifest as db_manifest;
use crate::{AppError, AppResult};

pub const REPORT_DIR_NAME: &str = "reports";
const MAX_REPORTS_PER_OPERATION: usize = 50;
const MAX_REPORT_BYTES: usize = 128 * 1024;
const MAX_ARRAY_ITEMS: usize = 100;
pub const REPORT_VERSION: u32 = 1;
pub const REPORT_SCHEMA_SHA256: &str =
    "29f418e12a009e1be1a9c09c80771cf076c03aa3e021fa406e8e1802ca2a892c";

const DETAILS_DENY_LIST: &[&str] = &["token", "email", "note_body", "username"];

#[cfg(any(debug_assertions, test))]
const REPORT_SCHEMA_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/schemas/report-v1.schema.json"
));

#[cfg(debug_assertions)]
static REPORT_SCHEMA: Lazy<JSONSchema> = Lazy::new(|| {
    let schema: Value =
        serde_json::from_str(REPORT_SCHEMA_SOURCE).expect("report schema should remain valid JSON");
    JSONSchema::compile(&schema).expect("report schema should compile")
});

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Health,
    Backup,
    Repair,
    HardRepair,
    Export,
    Import,
}

impl OperationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            OperationKind::Health => "health",
            OperationKind::Backup => "backup",
            OperationKind::Repair => "repair",
            OperationKind::HardRepair => "hard_repair",
            OperationKind::Export => "export",
            OperationKind::Import => "import",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    Success,
    Failed,
    Partial,
    Skipped,
}

/// Lightweight error descriptor included in persisted reports.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReportError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "map_is_empty")]
    pub context: Map<String, Value>,
}

impl ReportError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        ReportError {
            code: code.into(),
            message: message.into(),
            context: Map::new(),
        }
    }

    pub fn from_code(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(code, message)
    }

    pub fn with_context(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.context.insert(key.into(), value.into());
        self
    }

    pub fn truncation(total_dropped: usize) -> Self {
        ReportError::from_code(
            error_codes::TRUNCATED,
            format!(
                "Report exceeded {MAX_REPORT_BYTES} bytes; truncated {total_dropped} array elements"
            ),
        )
        .with_context("limit_bytes", MAX_REPORT_BYTES as u64)
        .with_context("dropped_elements", total_dropped as u64)
    }
}

pub mod error_codes {
    pub const TRUNCATED: &str = "OPS_REPORT/TRUNCATED";
}

fn map_is_empty(map: &Map<String, Value>) -> bool {
    map.is_empty()
}

#[derive(Serialize)]
struct ReportPayload {
    report_version: u32,
    schema_sha256: &'static str,
    id: String,
    op_id: String,
    operation: OperationKind,
    started_at: String,
    finished_at: String,
    elapsed_ms: i64,
    status: OperationStatus,
    app_version: String,
    schema_version: String,
    host_tz: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation_id: Option<String>,
    details: Value,
    errors: Vec<ReportError>,
}

/// Persist a structured JSON report for a completed database operation.
///
/// The `details` payload must include required keys for the given operation.
/// See [`DETAIL_KEY_CONTRACT`] for the canonical mapping.
pub async fn persist_report(
    pool: &SqlitePool,
    reports_root: &Path,
    operation: OperationKind,
    started_at: DateTime<Utc>,
    finished_at: DateTime<Utc>,
    status: OperationStatus,
    details: &Value,
    errors: &[ReportError],
    correlation_id: Option<&str>,
) -> AppResult<PathBuf> {
    validate_timestamps(started_at, finished_at)?;
    let schema_version = current_schema_version(pool).await?;
    validate_details(operation, details)?;
    guard_details_keys(details)?;
    validate_status_errors(status, errors)?;

    let year_component = started_at.format("%Y").to_string();
    let month_component = started_at.format("%m").to_string();
    let operation_root = reports_root.join(operation.as_str());
    let month_dir = operation_root.join(&year_component).join(&month_component);
    fs::create_dir_all(&month_dir).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_reports_dir")
            .with_context("path", month_dir.display().to_string())
    })?;

    let timestamp = started_at.format("%Y%m%d-%H%M%S");
    let random = Uuid::now_v7().as_simple().to_string();
    let suffix = &random[..8];
    let filename = format!("{}-{}-{}.json", operation.as_str(), timestamp, suffix);
    let report_path = month_dir.join(filename);

    let payload = ReportPayload {
        report_version: REPORT_VERSION,
        schema_sha256: REPORT_SCHEMA_SHA256,
        id: format!("op-{}-{}", timestamp, suffix),
        op_id: format!("{}-{}-{}", operation.as_str(), timestamp, suffix),
        operation,
        started_at: started_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        finished_at: finished_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        elapsed_ms: (finished_at - started_at).num_milliseconds().max(0),
        status,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version,
        host_tz: host_timezone_label(),
        correlation_id: correlation_id.map(|value| value.to_string()),
        details: details.clone(),
        errors: errors.to_vec(),
    };

    let serialized = serialize_with_bound(payload).map_err(|err| {
        err.with_context("operation", "serialize_report")
            .with_context("path", report_path.display().to_string())
    })?;

    #[cfg(debug_assertions)]
    debug_validate_against_schema(&serialized);

    crate::db::write_atomic(&report_path, &serialized).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "write_report")
            .with_context("path", report_path.display().to_string())
    })?;
    set_restrictive_permissions(&report_path);
    enforce_retention(operation, &operation_root)?;
    Ok(report_path)
}

pub fn reports_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(REPORT_DIR_NAME)
}

fn enforce_retention(operation: OperationKind, operation_root: &Path) -> AppResult<()> {
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    if !operation_root.exists() {
        return Ok(());
    }

    let years = fs::read_dir(operation_root).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "list_operation_reports_dir")
            .with_context("path", operation_root.display().to_string())
    })?;

    for year in years.flatten() {
        let year_name = year.file_name().to_string_lossy().into_owned();
        let year_path = year.path();
        if !year_path.is_dir() {
            continue;
        }
        let months = match fs::read_dir(&year_path) {
            Ok(months) => months,
            Err(err) => {
                tracing::warn!(
                    target = "arklowdun",
                    error = %err,
                    path = %year_path.display(),
                    "failed_to_list_reports_month_dir"
                );
                continue;
            }
        };
        for month in months.flatten() {
            let month_name = month.file_name().to_string_lossy().into_owned();
            let month_path = month.path();
            if !month_path.is_dir() {
                continue;
            }
            let files = match fs::read_dir(&month_path) {
                Ok(files) => files,
                Err(err) => {
                    tracing::warn!(
                        target = "arklowdun",
                        error = %err,
                        path = %month_path.display(),
                        "failed_to_list_reports_files"
                    );
                    continue;
                }
            };
            for file in files.flatten() {
                let file_name = file.file_name().to_string_lossy().into_owned();
                if !is_valid_report_filename(&file_name, operation.as_str()) {
                    continue;
                }
                let rel_key = format!("{}/{}/{}", year_name, month_name, file_name);
                entries.push((rel_key, file.path()));
            }
        }
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));
    if entries.len() <= MAX_REPORTS_PER_OPERATION {
        return Ok(());
    }

    let excess = entries.len().saturating_sub(MAX_REPORTS_PER_OPERATION);
    for (_, path) in entries.into_iter().take(excess) {
        if let Err(err) = fs::remove_file(&path) {
            tracing::warn!(
                target = "arklowdun",
                error = %err,
                file = %path.display(),
                "failed_to_remove_old_report"
            );
        }
    }

    Ok(())
}

fn is_valid_report_filename(file_name: &str, operation_prefix: &str) -> bool {
    let Some(stem) = file_name.strip_suffix(".json") else {
        return false;
    };
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() != 4 {
        return false;
    }
    if parts[0] != operation_prefix {
        return false;
    }
    let date = parts[1];
    let time = parts[2];
    let suffix = parts[3];
    date.len() == 8
        && date.chars().all(|c| c.is_ascii_digit())
        && time.len() == 6
        && time.chars().all(|c| c.is_ascii_digit())
        && suffix.len() == 8
        && suffix.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(debug_assertions)]
fn debug_validate_against_schema(bytes: &[u8]) {
    let value: Value =
        serde_json::from_slice(bytes).expect("persisted reports must serialize into valid JSON");
    {
        // Drop this result (and its borrowed iterator) before `value` goes out of scope.
        let res = REPORT_SCHEMA.validate(&value);
        if let Err(errors) = res {
            let messages: Vec<String> = errors.map(|e| e.to_string()).collect();
            panic!(
                "persisted report failed schema validation:\n{}",
                messages.join("\n")
            );
        }
    }
}

fn serialize_with_bound(payload: ReportPayload) -> AppResult<Vec<u8>> {
    let mut value = serde_json::to_value(&payload).map_err(AppError::from)?;
    let pretty = serde_json::to_vec_pretty(&value).map_err(AppError::from)?;
    if pretty.len() <= MAX_REPORT_BYTES {
        return Ok(pretty);
    }

    let dropped = truncate_large_arrays(&mut value);
    if dropped > 0 {
        if let Some(errors) = value
            .get_mut("errors")
            .and_then(|errors| errors.as_array_mut())
        {
            errors.push(json!(ReportError::truncation(dropped)));
        }
    }

    let pretty = serde_json::to_vec_pretty(&value).map_err(AppError::from)?;
    if pretty.len() <= MAX_REPORT_BYTES {
        return Ok(pretty);
    }

    let compact = serde_json::to_vec(&value).map_err(AppError::from)?;
    if compact.len() <= MAX_REPORT_BYTES {
        return Ok(compact);
    }

    Err(AppError::new(
        "OPS_REPORTING/SIZE_LIMIT",
        "Report payload exceeds the 128 KB limit even after truncation",
    ))
}

fn truncate_large_arrays(value: &mut Value) -> usize {
    match value {
        Value::Array(items) => {
            let mut dropped = 0;
            for item in items.iter_mut() {
                dropped += truncate_large_arrays(item);
            }
            if items.len() > MAX_ARRAY_ITEMS {
                let extra = items.len() - MAX_ARRAY_ITEMS;
                items.truncate(MAX_ARRAY_ITEMS);
                dropped += extra;
            }
            dropped
        }
        Value::Object(map) => map.values_mut().map(truncate_large_arrays).sum(),
        _ => 0,
    }
}

fn validate_details(operation: OperationKind, details: &Value) -> AppResult<()> {
    let obj = details.as_object().ok_or_else(|| {
        AppError::new(
            "OPS_REPORTING/DETAILS_TYPE",
            "Report details must be a JSON object",
        )
    })?;

    let required = required_detail_keys(operation);

    for key in required {
        if !obj.contains_key(*key) {
            return Err(AppError::new(
                "OPS_REPORTING/MISSING_DETAIL_KEY",
                format!("Missing required detail key: {key}"),
            )
            .with_context("operation", operation.as_str())
            .with_context("missing_key", key.to_string()));
        }
    }

    Ok(())
}

fn host_timezone_label() -> String {
    let now = Local::now();
    let offset = now.format("%:z");
    match get_timezone() {
        Ok(tz_name) => format!("{tz_name} ({offset})"),
        Err(_) => {
            let label = now.format("%Z").to_string();
            if label.trim().is_empty() {
                offset.to_string()
            } else {
                format!("{label} ({offset})")
            }
        }
    }
}

fn required_detail_keys(operation: OperationKind) -> &'static [&'static str] {
    match operation {
        OperationKind::Health => &DETAIL_KEY_CONTRACT[0].1,
        OperationKind::Backup => &DETAIL_KEY_CONTRACT[1].1,
        OperationKind::Repair => &DETAIL_KEY_CONTRACT[2].1,
        OperationKind::HardRepair => &DETAIL_KEY_CONTRACT[3].1,
        OperationKind::Export => &DETAIL_KEY_CONTRACT[4].1,
        OperationKind::Import => &DETAIL_KEY_CONTRACT[5].1,
    }
}

pub const DETAIL_KEY_CONTRACT: [(&str, &[&str]); 6] = [
    ("health", &["checks", "offenders"]),
    (
        "backup",
        &["backup_path", "manifest_path", "size_bytes", "sha256"],
    ),
    ("repair", &["steps", "outcome", "backup_path"]),
    (
        "hard_repair",
        &["attempted", "succeeded", "failed", "omissions_path"],
    ),
    (
        "export",
        &["export_path", "manifest_path", "counts", "hashes"],
    ),
    (
        "import",
        &["mode", "plan_counts", "applied_counts", "conflicts"],
    ),
];

fn guard_details_keys(details: &Value) -> AppResult<()> {
    if let Some(obj) = details.as_object() {
        for denied in DETAILS_DENY_LIST {
            if obj.contains_key(*denied) {
                return Err(AppError::new(
                    "OPS_REPORTING/DENYLISTED_KEY",
                    format!("Details must not include key: {denied}"),
                ));
            }
        }

        for value in obj.values() {
            if let Value::Object(child) = value {
                for denied in DETAILS_DENY_LIST {
                    if child.contains_key(*denied) {
                        return Err(AppError::new(
                            "OPS_REPORTING/DENYLISTED_KEY",
                            format!(
                                "Details must not include key: {denied} (found in nested object)"
                            ),
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn validate_timestamps(started_at: DateTime<Utc>, finished_at: DateTime<Utc>) -> AppResult<()> {
    if finished_at < started_at {
        return Err(AppError::new(
            "OPS_REPORTING/TIMESTAMPS",
            "finished_at must be greater than or equal to started_at",
        ));
    }
    Ok(())
}

fn validate_status_errors(status: OperationStatus, errors: &[ReportError]) -> AppResult<()> {
    match status {
        OperationStatus::Success => {
            if !errors.is_empty() {
                return Err(AppError::new(
                    "OPS_REPORTING/STATUS_ERRORS",
                    "Successful operations must not record errors",
                ));
            }
        }
        OperationStatus::Failed => {
            if errors.is_empty() {
                return Err(AppError::new(
                    "OPS_REPORTING/STATUS_ERRORS",
                    "Failed operations must include at least one error",
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn set_restrictive_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o600);
            if let Err(err) = fs::set_permissions(path, perms) {
                tracing::warn!(
                    target = "arklowdun",
                    error = %err,
                    file = %path.display(),
                    "failed_to_set_report_permissions"
                );
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

async fn current_schema_version(pool: &SqlitePool) -> AppResult<String> {
    if let Some(version) = sqlx::query_scalar::<_, String>(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|err| AppError::from(err).with_context("operation", "fetch_schema_version"))?
    {
        return Ok(db_manifest::normalize_schema_version_owned(version));
    }

    db_manifest::schema_hash(pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "schema_hash_fallback"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Duration, TimeZone};
    use jsonschema::JSONSchema;
    use serde_json::json;
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use sqlx::SqlitePool;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn validate_details_enforces_required_keys() {
        let details = json!({
            "backup_path": "/tmp/backup.tar",
            "manifest_path": "/tmp/manifest.json",
            "size_bytes": 1024,
            "sha256": "abc"
        });
        assert!(validate_details(OperationKind::Backup, &details).is_ok());

        let missing = json!({ "backup_path": "/tmp/backup.tar", "size_bytes": 1024 });
        let err = validate_details(OperationKind::Backup, &missing).unwrap_err();
        assert_eq!(err.code, "OPS_REPORTING/MISSING_DETAIL_KEY");
    }

    #[test]
    fn deny_list_blocks_sensitive_keys() {
        let details = json!({ "token": "secret" });
        let err = guard_details_keys(&details).unwrap_err();
        assert_eq!(err.code, "OPS_REPORTING/DENYLISTED_KEY");
    }

    #[test]
    fn deny_list_blocks_nested_sensitive_keys() {
        let details = json!({
            "export": {
                "token": "secret"
            }
        });
        let err = guard_details_keys(&details).unwrap_err();
        assert_eq!(err.code, "OPS_REPORTING/DENYLISTED_KEY");
    }

    #[test]
    fn serialization_truncates_arrays_and_emits_truncation_error() {
        let started = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let finished = started + Duration::seconds(1);

        let chunk = "x".repeat(1024);
        let large_items: Vec<Value> = (0..(MAX_ARRAY_ITEMS + 50))
            .map(|_| Value::String(chunk.clone()))
            .collect();

        let mut details = json!({
            "backup_path": "/tmp/backup.tar",
            "manifest_path": "/tmp/manifest.json",
            "size_bytes": 1024,
            "sha256": "abc",
            "items": []
        });
        details
            .as_object_mut()
            .unwrap()
            .insert("items".to_string(), Value::Array(large_items));

        let payload = ReportPayload {
            report_version: REPORT_VERSION,
            schema_sha256: REPORT_SCHEMA_SHA256,
            id: "op-20240101-000000-deadbeef".to_string(),
            op_id: "backup-20240101-000000-deadbeef".to_string(),
            operation: OperationKind::Backup,
            started_at: started.to_rfc3339_opts(SecondsFormat::Millis, true),
            finished_at: finished.to_rfc3339_opts(SecondsFormat::Millis, true),
            elapsed_ms: (finished - started).num_milliseconds(),
            status: OperationStatus::Success,
            app_version: "0.1.0".to_string(),
            schema_version: "0020_files_index_fks".to_string(),
            host_tz: host_timezone_label(),
            correlation_id: None,
            details,
            errors: vec![],
        };

        let serialized = serialize_with_bound(payload).expect("serialize report with truncation");
        assert!(serialized.len() <= MAX_REPORT_BYTES);

        let value: Value = serde_json::from_slice(&serialized).unwrap();
        let items = value["details"]["items"].as_array().unwrap();
        assert_eq!(items.len(), MAX_ARRAY_ITEMS);

        let errors = value["errors"].as_array().unwrap();
        assert!(errors
            .iter()
            .any(|error| error["code"].as_str() == Some(error_codes::TRUNCATED)));
    }

    #[test]
    fn status_validation_enforces_error_alignment() {
        let ok = validate_status_errors(OperationStatus::Partial, &[]);
        assert!(ok.is_ok());

        let err = validate_status_errors(OperationStatus::Failed, &[]).unwrap_err();
        assert_eq!(err.code, "OPS_REPORTING/STATUS_ERRORS");

        let err = validate_status_errors(
            OperationStatus::Success,
            &[ReportError::from_code(error_codes::TRUNCATED, "noop")],
        )
        .unwrap_err();
        assert_eq!(err.code, "OPS_REPORTING/STATUS_ERRORS");
    }

    #[test]
    fn enforce_retention_keeps_latest_fifty_reports() {
        let temp = tempdir().unwrap();
        let operation_root = temp.path().join("backup");
        for i in 0..55 {
            let year = 2023 + (i / 12);
            let month = (i % 12) + 1;
            let dir = operation_root
                .join(format!("{year}"))
                .join(format!("{month:02}"));
            fs::create_dir_all(&dir).unwrap();
            let filename = format!(
                "backup-2023{:02}{:02}-{:02}{:02}{:02}-{:08x}.json",
                month,
                (i % 28) + 1,
                (i % 24),
                (i % 60),
                (i % 60),
                i
            );
            let path = dir.join(filename);
            fs::write(path, b"{}").unwrap();
        }

        // Non-conforming files should be ignored and left alone.
        let junk_dir = operation_root.join("junk");
        fs::create_dir_all(&junk_dir).unwrap();
        fs::write(junk_dir.join("not-a-report.txt"), b"noop").unwrap();

        enforce_retention(OperationKind::Backup, &operation_root).unwrap();

        let mut count = 0usize;
        let years = fs::read_dir(&operation_root).unwrap();
        for year in years.flatten() {
            if !year.path().is_dir() {
                continue;
            }
            for month in fs::read_dir(year.path()).unwrap().flatten() {
                if !month.path().is_dir() {
                    continue;
                }
                for file in fs::read_dir(month.path()).unwrap().flatten() {
                    if file.path().extension().and_then(|s| s.to_str()) == Some("json") {
                        count += 1;
                    }
                }
            }
        }

        assert_eq!(count, 50);
        assert!(junk_dir.join("not-a-report.txt").exists());
    }

    #[test]
    fn enforce_retention_is_deterministic_for_duplicate_timestamps() {
        let temp = tempdir().unwrap();
        let operation_root = temp.path().join("backup");
        let month_dir = operation_root.join("2024").join("01");
        fs::create_dir_all(&month_dir).unwrap();

        for i in 0..(MAX_REPORTS_PER_OPERATION + 2) {
            let suffix = format!("{:08x}", i);
            let filename = format!("backup-20240101-000000-{suffix}.json");
            fs::write(month_dir.join(filename), b"{}").unwrap();
        }

        enforce_retention(OperationKind::Backup, &operation_root).unwrap();

        let mut remaining: Vec<String> = fs::read_dir(&month_dir)
            .unwrap()
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.ends_with(".json"))
            .collect();
        remaining.sort();

        assert_eq!(remaining.len(), MAX_REPORTS_PER_OPERATION);
        assert!(remaining
            .first()
            .unwrap()
            .ends_with(&format!("{:08x}.json", 2)));
        assert!(remaining
            .last()
            .unwrap()
            .ends_with(&format!("{:08x}.json", MAX_REPORTS_PER_OPERATION + 1)));
    }

    #[test]
    fn schema_hash_matches_source_file() {
        let mut hasher = Sha256::new();
        let schema_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("schemas")
            .join("report-v1.schema.json");
        let contents = fs::read(&schema_path).expect("read schema file");
        hasher.update(contents);
        let digest = hasher.finalize();
        assert_eq!(format!("{:x}", digest), REPORT_SCHEMA_SHA256);
    }

    #[test]
    fn validate_timestamps_rejects_inversion() {
        let started = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let finished = started - Duration::seconds(1);
        let err = validate_timestamps(started, finished).unwrap_err();
        assert_eq!(err.code, "OPS_REPORTING/TIMESTAMPS");
    }

    #[test]
    fn sample_report_matches_schema() {
        let started = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let finished = started + Duration::seconds(2);
        let payload = ReportPayload {
            report_version: REPORT_VERSION,
            schema_sha256: REPORT_SCHEMA_SHA256,
            id: "op-20240101-000000-deadbeef".to_string(),
            op_id: "backup-20240101-000000-deadbeef".to_string(),
            operation: OperationKind::Backup,
            started_at: started.to_rfc3339_opts(SecondsFormat::Millis, true),
            finished_at: finished.to_rfc3339_opts(SecondsFormat::Millis, true),
            elapsed_ms: (finished - started).num_milliseconds(),
            status: OperationStatus::Success,
            app_version: "0.1.0".to_string(),
            schema_version: "0020_files_index_fks".to_string(),
            host_tz: host_timezone_label(),
            correlation_id: None,
            details: json!({
                "backup_path": "/tmp/backup.tar",
                "manifest_path": "/tmp/manifest.json",
                "size_bytes": 1024,
                "sha256": "abc"
            }),
            errors: vec![],
        };

        let value = serde_json::to_value(&payload).unwrap();

        let schema_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("schemas")
            .join("report-v1.schema.json");
        let schema: Value = serde_json::from_slice(&fs::read(&schema_path).unwrap()).unwrap();
        let compiled = JSONSchema::compile(&schema).expect("compile schema");
        // Bind the result so the error iterator is dropped before `compiled`/`value`.
        let validation = compiled.validate(&value);
        if let Err(errors) = validation {
            let msgs: Vec<String> = errors.map(|e| e.to_string()).collect();
            panic!("report does not satisfy schema:\n{}", msgs.join("\n"));
        };
    }

    #[cfg(unix)]
    #[test]
    fn set_permissions_forces_0600_mode() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let path = temp.path().join("report.json");
        fs::write(&path, b"{}").unwrap();

        set_restrictive_permissions(&path);

        let metadata = fs::metadata(&path).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[tokio::test]
    async fn persist_report_records_elapsed_ms() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect in-memory db");
        sqlx::query("CREATE TABLE schema_migrations (version TEXT NOT NULL)")
            .execute(&pool)
            .await
            .expect("create schema_migrations");
        sqlx::query("INSERT INTO schema_migrations (version) VALUES (?1)")
            .bind("0020_files_index_fks")
            .execute(&pool)
            .await
            .expect("insert schema version");

        let temp = tempdir().unwrap();
        let started = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let finished = started + Duration::milliseconds(1500);
        let details = json!({
            "checks": [],
            "offenders": []
        });

        let path = persist_report(
            &pool,
            temp.path(),
            OperationKind::Health,
            started,
            finished,
            OperationStatus::Success,
            &details,
            &[],
            None,
        )
        .await
        .expect("persist report");

        let contents = fs::read_to_string(path).unwrap();
        let value: Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(value["elapsed_ms"], serde_json::json!(1500));
        let parsed_started: DateTime<Utc> = value["started_at"].as_str().unwrap().parse().unwrap();
        let parsed_finished: DateTime<Utc> =
            value["finished_at"].as_str().unwrap().parse().unwrap();
        assert!(parsed_finished >= parsed_started);
        assert_eq!(
            (parsed_finished - parsed_started).num_milliseconds(),
            value["elapsed_ms"].as_i64().unwrap()
        );
    }
}
