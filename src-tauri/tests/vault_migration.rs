#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use sqlx::SqlitePool;
use tauri::Manager;
use tempfile::tempdir;
use uuid::Uuid;

use arklowdun_lib::migrate;
use arklowdun_lib::vault::Vault;
use arklowdun_lib::vault_migration::{run_vault_migration, MigrationMode, VaultMigrationManager};

#[tokio::test]
async fn vault_migration_dry_run_and_apply_move_files() -> Result<()> {
    let tmp = tempdir()?;
    std::env::set_var("ARK_FAKE_APPDATA", tmp.path());

    let attachments_root = tmp.path().join("attachments");
    std::fs::create_dir_all(&attachments_root)?;

    let legacy_dir = tmp.path().join("legacy/docs");
    std::fs::create_dir_all(&legacy_dir)?;
    let legacy_path = legacy_dir.join("bill.pdf");
    std::fs::write(&legacy_path, b"legacy-bytes")?;

    let pool = SqlitePool::connect("sqlite::memory:").await?;
    migrate::apply_migrations(&pool).await?;

    let bill_id = Uuid::now_v7().to_string();
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO bills (
            id,
            amount,
            due_date,
            document,
            reminder,
            household_id,
            created_at,
            updated_at,
            deleted_at,
            position,
            root_key,
            relative_path,
            category
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL, ?8, ?9, ?10, ?11)",
    )
    .bind(&bill_id)
    .bind(12_500_i64)
    .bind(now)
    .bind::<Option<String>>(None)
    .bind::<Option<i64>>(None)
    .bind("default")
    .bind(now)
    .bind(0_i64)
    .bind("appData")
    .bind("legacy/bill.pdf")
    .bind("bills")
    .execute(&pool)
    .await?;

    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let vault = Arc::new(Vault::new(&attachments_root));
    let manager = Arc::new(VaultMigrationManager::new(&attachments_root)?);

    let dry = run_vault_migration(
        handle.clone(),
        pool.clone(),
        vault.clone(),
        manager.clone(),
        MigrationMode::DryRun,
    )
    .await?;

    assert_eq!(dry.counts.processed, 1, "dry-run processes legacy row");
    assert_eq!(dry.counts.copied, 1, "dry-run reports copy count");
    assert!(legacy_path.exists(), "dry-run must not modify source file");
    let manifest_path = dry.manifest_path.as_ref().expect("dry-run manifest path");
    assert!(std::path::Path::new(manifest_path).exists());
    let root_key_before: Option<String> =
        sqlx::query_scalar("SELECT root_key FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(root_key_before.as_deref(), Some("appData"));

    let apply = run_vault_migration(
        handle.clone(),
        pool.clone(),
        vault.clone(),
        manager.clone(),
        MigrationMode::Apply,
    )
    .await?;

    assert!(apply.completed, "apply run completes successfully");
    assert_eq!(apply.counts.copied, 1, "apply copies the legacy file");
    assert!(!legacy_path.exists(), "source file removed after apply");
    let final_path = attachments_root
        .join("default")
        .join("bills")
        .join("legacy")
        .join("bill.pdf");
    assert!(final_path.exists(), "vault now contains migrated file");

    let root_key_after: Option<String> =
        sqlx::query_scalar("SELECT root_key FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert!(root_key_after.is_none(), "legacy root cleared after apply");

    let category_after: Option<String> =
        sqlx::query_scalar("SELECT category FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(category_after.as_deref(), Some("bills"));

    let manifest_apply = apply.manifest_path.as_ref().expect("apply manifest path");
    assert!(std::path::Path::new(manifest_apply).exists());

    std::env::remove_var("ARK_FAKE_APPDATA");

    Ok(())
}
