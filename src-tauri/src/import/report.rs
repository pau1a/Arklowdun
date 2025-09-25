use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Utc;
use serde::Serialize;

use super::execute::ExecutionReport;
use super::plan::{ImportMode, ImportPlan};
use super::validator::ValidationReport;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReportFile {
    generated_at: String,
    bundle_path: String,
    mode: ImportMode,
    validation: ValidationReport,
    plan: ImportPlan,
    execution: ExecutionReport,
}

pub fn write_import_report(
    reports_dir: &Path,
    bundle_path: &Path,
    validation: &ValidationReport,
    plan: &ImportPlan,
    execution: &ExecutionReport,
) -> Result<PathBuf> {
    fs::create_dir_all(reports_dir)
        .with_context(|| format!("create reports directory {}", reports_dir.display()))?;

    let timestamp = Utc::now().format("import-%Y%m%d-%H%M%S.json");
    let path = reports_dir.join(timestamp.to_string());
    let payload = ImportReportFile {
        generated_at: Utc::now().to_rfc3339(),
        bundle_path: bundle_path.display().to_string(),
        mode: execution.mode,
        validation: validation.clone(),
        plan: plan.clone(),
        execution: execution.clone(),
    };
    let json = serde_json::to_string_pretty(&payload).context("serialize import report")?;
    fs::write(&path, json).with_context(|| format!("write import report {}", path.display()))?;
    Ok(path)
}
