use crate::{repo, AppError};
use sqlx::Row;
use std::path::Path;

/// Query a table for (root_key, relative_path).
#[allow(clippy::result_large_err)]
pub async fn load_attachment_columns(
    pool: &sqlx::SqlitePool,
    table: &str,
    id: &str,
) -> Result<(String, String), AppError> {
    repo::ensure_table(table)
        .map_err(|err| AppError::from(err).with_context("operation", "load_attachment_columns"))?;

    let sql = format!(
        "SELECT root_key, relative_path FROM {} WHERE id = ?1 AND deleted_at IS NULL",
        table
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "load_attachment_columns")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string())
        })?;

    if let Some(row) = row {
        let root_key: String = row.try_get("root_key").unwrap_or_default();
        let rel: String = row.try_get("relative_path").unwrap_or_default();
        if root_key.is_empty() || rel.is_empty() {
            return Err(AppError::new("IO/ENOENT", "No attachment on this record")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string()));
        }
        Ok((root_key, rel))
    } else {
        Err(AppError::new("DB/NOT_FOUND", "Record not found")
            .with_context("table", table.to_string())
            .with_context("id", id.to_string()))
    }
}

/// Open the file with the OS.
#[allow(clippy::result_large_err)]
pub fn open_with_os(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| {
                AppError::from(e)
                    .with_context("operation", "open_with_os")
                    .with_context("path", path.display().to_string())
            })?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let quoted = format!("\"{}\"", path.to_string_lossy());
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&quoted)
            .status()
            .map_err(|e| {
                AppError::from(e)
                    .with_context("operation", "open_with_os")
                    .with_context("path", path.display().to_string())
            })?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| {
                AppError::from(e)
                    .with_context("operation", "open_with_os")
                    .with_context("path", path.display().to_string())
            })?;
        Ok(())
    }
}

/// Reveal the file in the OS file manager.
#[allow(clippy::result_large_err)]
pub fn reveal_with_os(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        // Reveal in Finder
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .status()
            .map_err(|e| {
                AppError::from(e)
                    .with_context("operation", "reveal_with_os")
                    .with_context("path", path.display().to_string())
            })?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Select in Explorer
        std::process::Command::new("explorer")
            .arg(format!("/select,\"{}\"", path.to_string_lossy()))
            .status()
            .map_err(|e| {
                AppError::from(e)
                    .with_context("operation", "reveal_with_os")
                    .with_context("path", path.display().to_string())
            })?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Fallback: not universally supported; let UI copy the path
        let _ = path;
        Err(AppError::new(
            "IO/UNSUPPORTED_REVEAL",
            "Reveal not supported on this platform",
        ))
    }
}
