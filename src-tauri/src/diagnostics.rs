use serde::Serialize;
use std::{env, fs, path::PathBuf};

use crate::{git_commit_hash, resolve_logs_dir, AppError, AppResult, LOG_FILE_NAME};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub platform: String,
    pub arch: String,
    pub app_version: String,
    pub commit_hash: String,
    pub rust_log: Option<String>,
    pub rust_log_source: Option<String>,
    pub log_path: String,
    pub log_available: bool,
    pub log_tail: Vec<String>,
    pub log_truncated: bool,
    pub log_lines_returned: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    pub app_version: String,
    pub commit_hash: String,
}

pub fn gather_summary<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<Summary> {
    let platform = env::consts::OS.to_string();
    let arch = env::consts::ARCH.to_string();
    let app_version = app.package_info().version.to_string();
    let commit_hash = git_commit_hash().to_string();

    let mut rust_log_source = None;
    let rust_log = env::var("RUST_LOG")
        .ok()
        .map(|value| {
            rust_log_source = Some(String::from("RUST_LOG"));
            value
        })
        .or_else(|| {
            env::var("TAURI_ARKLOWDUN_LOG").ok().map(|value| {
                rust_log_source = Some(String::from("TAURI_ARKLOWDUN_LOG"));
                value
            })
        });

    let logs_dir = resolve_logs_dir(app).map_err(|err| {
        AppError::new("DIAGNOSTICS/LOGS_DIR", "Failed to locate log directory")
            .with_context("error", err.to_string())
    })?;

    let log_path = logs_dir.join(LOG_FILE_NAME);
    let log_path_str = log_path.display().to_string();

    let mut log_tail: Vec<String> = Vec::new();
    let mut log_truncated = false;
    let mut log_available = false;

    if log_path.exists() {
        log_available = true;
        let content = fs::read_to_string(&log_path).map_err(|err| {
            AppError::new("DIAGNOSTICS/READ_LOG", "Failed to read log file")
                .with_context("path", log_path_str.clone())
                .with_context("error", err.to_string())
        })?;
        let lines: Vec<&str> = content.lines().collect();
        let total = lines.len();
        let start = total.saturating_sub(200);
        log_truncated = total > 200;
        log_tail = lines
            .into_iter()
            .skip(start)
            .map(|line| line.to_string())
            .collect();
    }

    let log_lines_returned = log_tail.len();

    Ok(Summary {
        platform,
        arch,
        app_version,
        commit_hash,
        rust_log,
        rust_log_source,
        log_path: log_path_str,
        log_available,
        log_tail,
        log_truncated,
        log_lines_returned,
    })
}

pub fn about_info<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AboutInfo {
    AboutInfo {
        app_version: app.package_info().version.to_string(),
        commit_hash: git_commit_hash().to_string(),
    }
}

pub fn resolve_doc_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    use tauri::path::BaseDirectory;

    let path_manager = app.path();

    match path_manager.resolve("docs/diagnostics.md", BaseDirectory::Resource) {
        Ok(path) => Ok(path.to_string_lossy().to_string()),
        Err(primary_err) => {
            if let Ok(mut resource_dir) = path_manager.resource_dir() {
                let mut nested = resource_dir.clone();
                nested.push("docs");
                nested.push("diagnostics.md");
                if nested.exists() {
                    return Ok(nested.to_string_lossy().to_string());
                }

                resource_dir.push("diagnostics.md");
                if resource_dir.exists() {
                    return Ok(resource_dir.to_string_lossy().to_string());
                }
            }

            let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docs/diagnostics.md");
            if fallback.exists() {
                return Ok(fallback.to_string_lossy().to_string());
            }

            Err(
                AppError::new(
                    "DIAGNOSTICS/DOC_MISSING",
                    "Diagnostics guide is not bundled",
                )
                .with_context("error", primary_err.to_string()),
            )
        }
    }
}
