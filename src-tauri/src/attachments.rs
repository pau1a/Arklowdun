use crate::commands::DbErrorPayload;
use crate::repo;
use sqlx::Row;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Map our string root_key to a base directory.
fn resolve_root(app: &AppHandle, root_key: &str) -> Option<PathBuf> {
    match root_key {
        // app data is what you already use in the UI
        "appData" => app.path().app_data_dir().ok(),
        // useful extras if you ever emit them:
        "home" => app.path().home_dir().ok(),
        "temp" => app.path().temp_dir().ok(),
        _ => None,
    }
}

/// Resolve (root_key, relative_path) to an absolute path, or return a typed IO error.
pub fn resolve_attachment_path(
    app: &AppHandle,
    root_key: &str,
    relative_path: &str,
) -> Result<PathBuf, DbErrorPayload> {
    let base = resolve_root(app, root_key).ok_or(DbErrorPayload {
        code: "IO/UNKNOWN".into(),
        message: format!("Unknown root_key: {}", root_key),
    })?;

    let base = base.canonicalize().map_err(|e| DbErrorPayload {
        code: "IO/UNKNOWN".into(),
        message: e.to_string(),
    })?;
    let mut path = base.clone();
    path.push(relative_path);

    let path = path.canonicalize().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            DbErrorPayload {
                code: "IO/ENOENT".into(),
                message: "File not found".into(),
            }
        } else {
            DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
            }
        }
    })?;

    if !path.starts_with(&base) {
        return Err(DbErrorPayload {
            code: "IO/INVALID_PATH".into(),
            message: "Relative path escapes base directory".into(),
        });
    }

    Ok(path)
}

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
pub fn open_with_os(path: &PathBuf) -> Result<(), DbErrorPayload> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| DbErrorPayload {
                code: "IO/UNKNOWN".into(),
                message: e.to_string(),
            })?;
        return Ok(());
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
        return Ok(());
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
        return Ok(());
    }
}

/// Reveal the file in the OS file manager.
pub fn reveal_with_os(path: &PathBuf) -> Result<(), DbErrorPayload> {
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
        return Ok(());
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
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        // Fallback: not universally supported; let UI copy the path
        return Err(DbErrorPayload {
            code: "IO/UNSUPPORTED_REVEAL".into(),
            message: "Reveal not supported on this platform".into(),
        });
    }
}
