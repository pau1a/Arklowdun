use crate::commands::DbErrorPayload;
use crate::repo;
use sqlx::Row;
use std::path::Path;

/// Query a table for (root_key, relative_path).
pub async fn load_attachment_columns(
    pool: &sqlx::SqlitePool,
    table: &str,
    id: &str,
) -> Result<(String, String), DbErrorPayload> {
    repo::ensure_table(table).map_err(|e| DbErrorPayload {
        code: "DB/NOT_FOUND".into(),
        message: e.to_string(),
    })?;

    let sql = format!(
        "SELECT root_key, relative_path FROM {} WHERE id = ?1 AND deleted_at IS NULL",
        table
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| DbErrorPayload {
            code: "Unknown".into(),
            message: e.to_string(),
        })?;

    if let Some(row) = row {
        let root_key: String = row.try_get("root_key").unwrap_or_default();
        let rel: String = row.try_get("relative_path").unwrap_or_default();
        if root_key.is_empty() || rel.is_empty() {
            return Err(DbErrorPayload {
                code: "IO/ENOENT".into(),
                message: "No attachment on this record".into(),
            });
        }
        Ok((root_key, rel))
    } else {
        Err(DbErrorPayload {
            code: "DB/NOT_FOUND".into(),
            message: "Record not found".into(),
        })
    }
}

/// Open the file with the OS.
pub fn open_with_os(path: &Path) -> Result<(), DbErrorPayload> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
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
            .map_err(|e| DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
            })?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
            })?;
        Ok(())
    }
}

/// Reveal the file in the OS file manager.
pub fn reveal_with_os(path: &Path) -> Result<(), DbErrorPayload> {
    #[cfg(target_os = "macos")]
    {
        // Reveal in Finder
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .status()
            .map_err(|e| DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
            })?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Select in Explorer
        std::process::Command::new("explorer")
            .arg(format!("/select,\"{}\"", path.to_string_lossy()))
            .status()
            .map_err(|e| DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
            })?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Fallback: not universally supported; let UI copy the path
        let _ = path;
        Err(DbErrorPayload {
            code: "IO/UNSUPPORTED_REVEAL".into(),
            message: "Reveal not supported on this platform".into(),
        })
    }
}
