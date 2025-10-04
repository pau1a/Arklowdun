use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{collections::BTreeMap, env, fs, path::PathBuf};

use crate::{git_commit_hash, resolve_logs_dir, AppError, AppResult, LOG_FILE_NAME};
use tauri::Manager;

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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdStatsEntry {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub counts: BTreeMap<String, u64>,
}

struct CountSpec {
    table: &'static str,
    alias: &'static str,
    filter_deleted: bool,
}

macro_rules! household_count_specs {
    ($($table:literal => $alias:literal => $filter_deleted:expr),+ $(,)?) => {
        const COUNT_SPECS: &[CountSpec] = &[
            $(CountSpec {
                table: $table,
                alias: $alias,
                filter_deleted: $filter_deleted,
            }),+
        ];

        pub const HOUSEHOLD_STATS_ALIASES: &[&str] = &[
            $($alias),+
        ];
    };
}

household_count_specs! {
    "notes" => "notes" => true,
    "events" => "events" => true,
    "files_index" => "files" => false,
    "bills" => "bills" => true,
    "policies" => "policies" => true,
    "property_documents" => "propertyDocuments" => true,
    "inventory_items" => "inventoryItems" => true,
    "vehicles" => "vehicles" => true,
    "vehicle_maintenance" => "vehicleMaintenance" => true,
    "pets" => "pets" => true,
    "pet_medical" => "petMedical" => true,
    "family_members" => "familyMembers" => true,
    "categories" => "categories" => true,
    "budget_categories" => "budgetCategories" => true,
    "expenses" => "expenses" => true,
    "shopping_items" => "shoppingItems" => true,
    "note_links" => "noteLinks" => false,
}

#[allow(clippy::result_large_err)]
pub fn gather_summary<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<Summary> {
    let platform = env::consts::OS.to_string();
    let arch = env::consts::ARCH.to_string();
    let app_version = app.package_info().version.to_string();
    let commit_hash = git_commit_hash().to_string();

    let mut rust_log_source = None;
    let rust_log = env::var("RUST_LOG")
        .ok()
        .inspect(|_| {
            rust_log_source = Some(String::from("RUST_LOG"));
        })
        .or_else(|| {
            env::var("TAURI_ARKLOWDUN_LOG").ok().inspect(|_| {
                rust_log_source = Some(String::from("TAURI_ARKLOWDUN_LOG"));
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

#[derive(sqlx::FromRow)]
struct HouseholdRow {
    id: String,
    name: String,
    is_default: i64,
}

#[allow(clippy::result_large_err)]
pub async fn household_stats(pool: &SqlitePool) -> AppResult<Vec<HouseholdStatsEntry>> {
    let households = sqlx::query_as::<_, HouseholdRow>(
        "SELECT id, name, is_default FROM household ORDER BY name COLLATE NOCASE, id",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;

    let mut stats: Vec<HouseholdStatsEntry> = households
        .into_iter()
        .map(|row| {
            let mut counts = BTreeMap::new();
            for spec in COUNT_SPECS {
                counts.insert(spec.alias.to_string(), 0);
            }
            HouseholdStatsEntry {
                id: row.id,
                name: row.name,
                is_default: row.is_default != 0,
                counts,
            }
        })
        .collect();

    if stats.is_empty() {
        return Ok(Vec::new());
    }

    let mut index_by_id = std::collections::HashMap::new();
    for (idx, entry) in stats.iter().enumerate() {
        index_by_id.insert(entry.id.clone(), idx);
    }

    for spec in COUNT_SPECS {
        let sql = if spec.filter_deleted {
            format!(
                "SELECT household_id, COUNT(*) as count FROM {} WHERE deleted_at IS NULL GROUP BY household_id",
                spec.table
            )
        } else {
            format!(
                "SELECT household_id, COUNT(*) as count FROM {} GROUP BY household_id",
                spec.table
            )
        };

        let rows = sqlx::query_as::<_, (String, i64)>(&sql)
            .fetch_all(pool)
            .await
            .map_err(AppError::from)?;

        for (household_id, count) in rows {
            if let Some(index) = index_by_id.get(&household_id) {
                if let Some(entry) = stats.get_mut(*index) {
                    entry
                        .counts
                        .insert(spec.alias.to_string(), count.max(0) as u64);
                }
            }
        }
    }

    Ok(stats)
}

#[allow(clippy::result_large_err)]
pub fn resolve_doc_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    use tauri::path::BaseDirectory;

    let path_manager = app.path();

    let candidates = ["resources/docs/diagnostics.md", "docs/diagnostics.md"];

    for relative in candidates {
        match path_manager.resolve(relative, BaseDirectory::Resource) {
            Ok(path) => {
                if path.exists() {
                    return Ok(path.to_string_lossy().to_string());
                }
            }
            Err(err) => {
                tracing::debug!(
                    target: "arklowdun",
                    event = "diagnostics_doc_resolve_failed",
                    candidate = relative,
                    error = %err
                );
            }
        }
    }

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
    let fallback_display = fallback.to_string_lossy().to_string();
    if fallback.exists() {
        return Ok(fallback.to_string_lossy().to_string());
    }

    Err(
        AppError::new(
            "DIAGNOSTICS/DOC_MISSING",
            "Diagnostics guide is not bundled",
        )
        .with_context(
            "searched",
            format!(
                "resources/docs/diagnostics.md, docs/diagnostics.md, resource_dir/docs/diagnostics.md, resource_dir/diagnostics.md, {}",
                fallback_display
            ),
        ),
    )
}
