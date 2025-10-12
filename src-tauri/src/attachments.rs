use crate::{
    attachment_category::AttachmentCategory,
    repo,
    vault::{ERR_INVALID_CATEGORY, ERR_INVALID_HOUSEHOLD},
    AppError,
};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;

#[derive(Debug, Clone)]
pub struct AttachmentDescriptor {
    pub household_id: String,
    pub category: AttachmentCategory,
    pub relative_path: String,
}

/// Query a table for the attachment vault coordinates.
#[allow(clippy::result_large_err)]
pub async fn load_attachment_descriptor(
    pool: &sqlx::SqlitePool,
    table: &str,
    id: &str,
) -> Result<AttachmentDescriptor, AppError> {
    repo::ensure_table(table).map_err(|err| {
        AppError::from(err).with_context("operation", "load_attachment_descriptor")
    })?;

    if table == "member_attachments" {
        let row =
            sqlx::query("SELECT household_id, relative_path FROM member_attachments WHERE id = ?1")
                .bind(id)
                .fetch_optional(pool)
                .await
                .map_err(|err| {
                    AppError::from(err)
                        .with_context("operation", "load_attachment_descriptor")
                        .with_context("table", table.to_string())
                        .with_context("id", id.to_string())
                })?;

        let Some(row) = row else {
            return Err(AppError::new("DB/NOT_FOUND", "Record not found")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string()));
        };

        let household_id: Option<String> = row.try_get("household_id").ok();
        let relative_path: Option<String> = row.try_get("relative_path").ok();

        let household_id = household_id
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new(
                    ERR_INVALID_HOUSEHOLD,
                    "Attachment record is missing a valid household.",
                )
            })?;

        let relative_path = relative_path.filter(|v| !v.is_empty()).ok_or_else(|| {
            AppError::new("IO/ENOENT", "No attachment on this record")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string())
        })?;

        return Ok(AttachmentDescriptor {
            household_id,
            category: AttachmentCategory::Misc,
            relative_path,
        });
    }

    if table == "pets" {
        let row = sqlx::query(
            "SELECT household_id, image_path FROM pets WHERE id = ?1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "load_attachment_descriptor")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string())
        })?;

        let Some(row) = row else {
            return Err(AppError::new("DB/NOT_FOUND", "Record not found")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string()));
        };

        let household_id: Option<String> = row.try_get("household_id").ok();
        let relative_path: Option<String> = row.try_get("image_path").ok();

        let household_id = household_id
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new(
                    ERR_INVALID_HOUSEHOLD,
                    "Attachment record is missing a valid household.",
                )
            })?;

        let relative_path = relative_path
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new("IO/ENOENT", "No attachment on this record")
                    .with_context("table", table.to_string())
                    .with_context("id", id.to_string())
            })?;

        return Ok(AttachmentDescriptor {
            household_id,
            category: AttachmentCategory::PetImage,
            relative_path,
        });
    }

    let sql = format!(
        "SELECT household_id, category, relative_path FROM {} WHERE id = ?1 AND deleted_at IS NULL",
        table
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "load_attachment_descriptor")
                .with_context("table", table.to_string())
                .with_context("id", id.to_string())
        })?;

    let Some(row) = row else {
        return Err(AppError::new("DB/NOT_FOUND", "Record not found")
            .with_context("table", table.to_string())
            .with_context("id", id.to_string()));
    };

    let household_id: Option<String> = row.try_get("household_id").ok();
    let category: Option<String> = row.try_get("category").ok();
    let relative_path: Option<String> = row.try_get("relative_path").ok();

    let household_id = household_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::new(
                ERR_INVALID_HOUSEHOLD,
                "Attachment record is missing a valid household.",
            )
        })?;

    let relative_path = relative_path.filter(|v| !v.is_empty()).ok_or_else(|| {
        AppError::new("IO/ENOENT", "No attachment on this record")
            .with_context("table", table.to_string())
            .with_context("id", id.to_string())
    })?;

    let category = category.ok_or_else(|| {
        AppError::new(ERR_INVALID_CATEGORY, "Attachment category is required.")
            .with_context("table", table.to_string())
            .with_context("id", id.to_string())
    })?;

    let category = AttachmentCategory::from_str(&category).map_err(|_| {
        AppError::new(
            ERR_INVALID_CATEGORY,
            "Attachment category is not supported.",
        )
        .with_context("table", table.to_string())
        .with_context("id", id.to_string())
        .with_context("category", category)
    })?;

    Ok(AttachmentDescriptor {
        household_id,
        category,
        relative_path,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use sqlx::SqlitePool;
    use tempfile::TempDir;

    async fn setup_pool(dir: &TempDir, db_name: &str) -> Result<SqlitePool> {
        let path = dir.path().join(db_name);
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display())).await?;
        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&pool)
            .await?;
        crate::migrate::apply_migrations(&pool).await?;
        Ok(pool)
    }

    async fn seed_household(pool: &SqlitePool, household_id: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO household (id, name, created_at, updated_at, tz, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(household_id)
        .bind("Test Household")
        .bind(1_i64)
        .bind(1_i64)
        .bind("UTC")
        .bind(1_i64)
        .execute(pool)
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn pets_descriptor_maps_to_pet_image_category() -> Result<()> {
        let dir = TempDir::new()?;
        let pool = setup_pool(&dir, "pets_descriptor.sqlite").await?;
        seed_household(&pool, "hh-test").await?;

        sqlx::query(
            "INSERT INTO pets (id, name, type, household_id, image_path, created_at, updated_at, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind("pet-1")
        .bind("Whisky")
        .bind("dog")
        .bind("hh-test")
        .bind("whisky.png")
        .bind(1_i64)
        .bind(1_i64)
        .bind(0_i64)
        .execute(&pool)
        .await?;

        let descriptor = load_attachment_descriptor(&pool, "pets", "pet-1").await?;
        assert_eq!(descriptor.household_id, "hh-test");
        assert_eq!(descriptor.category, AttachmentCategory::PetImage);
        assert_eq!(descriptor.relative_path, "whisky.png");

        Ok(())
    }

    #[tokio::test]
    async fn pets_descriptor_rejects_missing_path() -> Result<()> {
        let dir = TempDir::new()?;
        let pool = setup_pool(&dir, "pets_descriptor_missing.sqlite").await?;
        seed_household(&pool, "hh-test").await?;

        sqlx::query(
            "INSERT INTO pets (id, name, type, household_id, image_path, created_at, updated_at, position) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)",
        )
        .bind("pet-2")
        .bind("Porter")
        .bind("cat")
        .bind("hh-test")
        .bind(1_i64)
        .bind(1_i64)
        .bind(0_i64)
        .execute(&pool)
        .await?;

        let err = load_attachment_descriptor(&pool, "pets", "pet-2")
            .await
            .expect_err("expected missing image to be rejected");
        assert_eq!(err.code(), "IO/ENOENT");

        Ok(())
    }
}
