use std::fs;
use std::path::Path;

use include_dir::{include_dir, Dir};
use rusqlite::Connection;

use crate::{AppError, AppResult};

static MIGRATIONS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../migrations");

fn sorted_migrations() -> Vec<&'static include_dir::File<'static>> {
    let mut files: Vec<_> = MIGRATIONS_DIR
        .files()
        .filter(|file| {
            file.path()
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    // Accept numbered migrations: e.g., 0001_baseline.sql, 0002_feature.up.sql
                    // Exclude any *.down.sql and helper files like template.sql or names starting with '_'.
                    let not_disabled = !name.starts_with('_');
                    let is_sql = name.ends_with(".sql");
                    let is_down = name.ends_with(".down.sql");
                    let starts_with_digits = name.len() > 5
                        && name.chars().take(4).all(|c| c.is_ascii_digit())
                        && name.chars().nth(4) == Some('_');
                    not_disabled && is_sql && !is_down && starts_with_digits
                })
                .unwrap_or(false)
        })
        .collect();
    files.sort_by_key(|file| file.path().to_path_buf());
    files
}

pub fn rebuild_schema(dest: &Path) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "create_schema_parent")
                .with_context("path", parent.display().to_string())
        })?;
    }

    if dest.exists() {
        fs::remove_file(dest).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "remove_existing_schema")
                .with_context("path", dest.display().to_string())
        })?;
    }

    let conn = Connection::open(dest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_new_schema")
            .with_context("path", dest.display().to_string())
    })?;

    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "foreign_keys", 1).ok();

    for file in sorted_migrations() {
        let sql = file.contents_utf8().ok_or_else(|| {
            AppError::new(
                "DB_SCHEMA_REBUILD/INVALID_UTF8",
                "Migration file is not valid UTF-8",
            )
            .with_context("path", file.path().display().to_string())
        })?;
        conn.execute_batch(sql).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "apply_migration")
                .with_context("path", file.path().display().to_string())
        })?;
    }

    conn.flush_prepared_statement_cache();
    conn.close().map_err(|(_, err)| {
        AppError::from(err)
            .with_context("operation", "close_schema_conn")
            .with_context("path", dest.display().to_string())
    })?;

    Ok(())
}

/// Rebuild the schema using only the canonical baseline migration.
/// This produces the latest schema in one shot and avoids duplicate
/// column errors that can occur when applying incremental migrations
/// on a fresh database that already matches the final shape.
pub fn rebuild_schema_baseline(dest: &Path) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "create_schema_parent")
                .with_context("path", parent.display().to_string())
        })?;
    }

    if dest.exists() {
        fs::remove_file(dest).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "remove_existing_schema")
                .with_context("path", dest.display().to_string())
        })?;
    }

    let conn = Connection::open(dest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_new_schema")
            .with_context("path", dest.display().to_string())
    })?;

    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "foreign_keys", 1).ok();

    // Find baseline file
    let baseline = MIGRATIONS_DIR
        .files()
        .find(|f| f.path().file_name().and_then(|n| n.to_str()) == Some("0001_baseline.sql"))
        .ok_or_else(|| AppError::new("DB_SCHEMA_REBUILD/BASELINE_MISSING", "Baseline migration not found"))?;

    let sql = baseline.contents_utf8().ok_or_else(|| {
        AppError::new(
            "DB_SCHEMA_REBUILD/INVALID_UTF8",
            "Migration file is not valid UTF-8",
        )
        .with_context("path", baseline.path().display().to_string())
    })?;
    conn.execute_batch(sql).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "apply_migration")
            .with_context("path", baseline.path().display().to_string())
    })?;

    conn.flush_prepared_statement_cache();
    conn.close().map_err(|(_, err)| {
        AppError::from(err)
            .with_context("operation", "close_schema_conn")
            .with_context("path", dest.display().to_string())
    })?;

    Ok(())
}
