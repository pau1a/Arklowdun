#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use sqlx::SqlitePool;
use tauri::Manager;
use tempfile::tempdir;
use uuid::Uuid;

use arklowdun_lib::attachment_category::AttachmentCategory;
use arklowdun_lib::file_ops::{
    attachments_repair as run_attachments_repair,
    attachments_repair_manifest_export as run_attachments_repair_manifest_export,
    move_file as run_file_move, AttachmentsRepairMode, AttachmentsRepairRequest, ConflictStrategy,
    FileMoveRequest, RepairAction, RepairActionKind,
};
use arklowdun_lib::migrate;
use arklowdun_lib::vault::Vault;

async fn setup_pool() -> Result<SqlitePool> {
    let pool = SqlitePool::connect("sqlite::memory:").await?;
    migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

async fn seed_household(pool: &SqlitePool, household_id: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, color) VALUES (?1, ?2, ?3, ?3, NULL, NULL)",
    )
    .bind(household_id)
    .bind(format!("Household {household_id}"))
    .bind(Utc::now().timestamp())
    .execute(pool)
    .await?;
    Ok(())
}

fn setup_vault(root: &PathBuf) -> Arc<Vault> {
    Arc::new(Vault::new(root))
}

fn attachment_path(
    root: &PathBuf,
    household: &str,
    category: AttachmentCategory,
    relative: &str,
) -> PathBuf {
    root.join(household).join(category.as_str()).join(relative)
}

async fn insert_files_index(
    pool: &SqlitePool,
    household_id: &str,
    file_id: &str,
    category: AttachmentCategory,
    filename: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO files_index (household_id, file_id, category, filename, updated_at_utc, ordinal, score_hint) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
    )
    .bind(household_id)
    .bind(file_id)
    .bind(category.as_str())
    .bind(filename)
    .bind("2024-01-01T00:00:00Z")
    .bind(0_i64)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_bill(
    pool: &SqlitePool,
    id: &str,
    household_id: &str,
    category: AttachmentCategory,
    relative_path: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO bills (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path, category) VALUES (?1, 1000, ?2, NULL, NULL, ?3, ?2, ?2, NULL, 0, 'attachments', ?4, ?5)",
    )
    .bind(id)
    .bind(Utc::now().timestamp())
    .bind(household_id)
    .bind(relative_path)
    .bind(category.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_policy(
    pool: &SqlitePool,
    id: &str,
    household_id: &str,
    category: AttachmentCategory,
    relative_path: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO policies (id, provider, policy_number, description, household_id, created_at, updated_at, deleted_at, start_date, end_date, renewal_type, premium, relative_path, category) VALUES (?1, 'Acme', 'POL123', 'Test policy', ?2, ?3, ?3, NULL, ?3, NULL, 'none', 0, ?4, ?5)",
    )
    .bind(id)
    .bind(household_id)
    .bind(Utc::now().timestamp())
    .bind(relative_path)
    .bind(category.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_inventory(
    pool: &SqlitePool,
    id: &str,
    household_id: &str,
    relative_path: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO inventory_items (id, name, household_id, created_at, updated_at, deleted_at, category, relative_path, quantity, value) VALUES (?1, 'Lamp', ?2, ?3, ?3, NULL, 'inventory_items', ?4, 1, 100)",
    )
    .bind(id)
    .bind(household_id)
    .bind(Utc::now().timestamp())
    .bind(relative_path)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_pet_medical(
    pool: &SqlitePool,
    id: &str,
    household_id: &str,
    relative_path: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO pet_medical (id, pet_id, visit_date, reason, household_id, created_at, updated_at, deleted_at, category, relative_path) VALUES (?1, 'pet', ?2, 'Checkup', ?3, ?2, ?2, NULL, 'pet_medical', ?4)",
    )
    .bind(id)
    .bind(Utc::now().timestamp())
    .bind(household_id)
    .bind(relative_path)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::test]
async fn move_cross_category_same_volume() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh1";
    seed_household(&pool, household_id).await?;

    let from_category = AttachmentCategory::Bills;
    let to_category = AttachmentCategory::Policies;
    let from_rel = "source/report.pdf";
    let to_rel = "destination/renamed.pdf";

    let source_path = attachment_path(&root, household_id, from_category, from_rel);
    std::fs::create_dir_all(source_path.parent().unwrap())?;
    std::fs::write(&source_path, b"test-bytes")?;

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(&pool, &bill_id, household_id, from_category, from_rel).await?;

    let file_id = Uuid::now_v7().to_string();
    insert_files_index(
        &pool,
        household_id,
        &file_id,
        from_category,
        PathBuf::from(from_rel)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_ref(),
    )
    .await?;

    let request = FileMoveRequest {
        household_id: household_id.to_string(),
        from_category,
        from_rel: from_rel.to_string(),
        to_category,
        to_rel: to_rel.to_string(),
        conflict: ConflictStrategy::Rename,
    };

    let response = run_file_move(handle.clone(), pool.clone(), vault.clone(), request).await?;
    assert_eq!(response.renamed, false);
    assert_eq!(response.moved, 2);

    let target_path = attachment_path(&root, household_id, to_category, to_rel);
    assert!(target_path.exists(), "target file must exist after move");
    assert!(!source_path.exists(), "source file removed after move");

    let updated_relative: Option<String> =
        sqlx::query_scalar("SELECT relative_path FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(updated_relative.as_deref(), Some(to_rel));

    let updated_category: Option<String> =
        sqlx::query_scalar("SELECT category FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(updated_category.as_deref(), Some(to_category.as_str()));

    let index_row: Option<(String, String)> = sqlx::query_as(
        "SELECT category, filename FROM files_index WHERE household_id = ?1 AND file_id = ?2",
    )
    .bind(household_id)
    .bind(&file_id)
    .fetch_one(&pool)
    .await?;
    let (category, filename) = index_row.expect("index row present");
    assert_eq!(category, to_category.as_str());
    assert_eq!(
        filename,
        PathBuf::from(to_rel).file_name().unwrap().to_string_lossy()
    );

    Ok(())
}

#[tokio::test]
async fn move_cross_volume_copy_fallback_sets_indicator() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_copy";
    seed_household(&pool, household_id).await?;

    let from_category = AttachmentCategory::Bills;
    let to_category = AttachmentCategory::Policies;
    let from_rel = "docs/original.pdf";
    let to_rel = "docs/copied.pdf";

    let source_path = attachment_path(&root, household_id, from_category, from_rel);
    std::fs::create_dir_all(source_path.parent().unwrap())?;
    std::fs::write(&source_path, b"copy-bytes")?;

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(&pool, &bill_id, household_id, from_category, from_rel).await?;

    let file_id = Uuid::now_v7().to_string();
    insert_files_index(
        &pool,
        household_id,
        &file_id,
        from_category,
        PathBuf::from(from_rel)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_ref(),
    )
    .await?;

    arklowdun_lib::file_ops::__force_copy_fallback(true);

    let request = FileMoveRequest {
        household_id: household_id.to_string(),
        from_category,
        from_rel: from_rel.to_string(),
        to_category,
        to_rel: to_rel.to_string(),
        conflict: ConflictStrategy::Rename,
    };

    let response = run_file_move(handle.clone(), pool.clone(), vault.clone(), request).await?;
    assert_eq!(response.moved, 2);
    assert!(arklowdun_lib::file_ops::__take_last_move_used_copy());

    arklowdun_lib::file_ops::__force_copy_fallback(false);

    Ok(())
}

#[tokio::test]
async fn move_returns_error_when_lock_held() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_lock";
    seed_household(&pool, household_id).await?;

    let from_category = AttachmentCategory::Bills;
    let from_rel = "lock/source.pdf";
    let to_category = AttachmentCategory::Policies;
    let to_rel = "lock/target.pdf";

    let source_path = attachment_path(&root, household_id, from_category, from_rel);
    std::fs::create_dir_all(source_path.parent().unwrap())?;
    std::fs::write(&source_path, b"lock-bytes")?;

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(&pool, &bill_id, household_id, from_category, from_rel).await?;

    let file_id = Uuid::now_v7().to_string();
    insert_files_index(
        &pool,
        household_id,
        &file_id,
        from_category,
        PathBuf::from(from_rel)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_ref(),
    )
    .await?;

    let _guard = arklowdun_lib::file_ops::__acquire_move_lock_for_test(
        household_id,
        from_category,
        &from_rel.replace('\\', "/"),
    )?;

    let request = FileMoveRequest {
        household_id: household_id.to_string(),
        from_category,
        from_rel: from_rel.to_string(),
        to_category,
        to_rel: to_rel.to_string(),
        conflict: ConflictStrategy::Rename,
    };

    let err = run_file_move(handle.clone(), pool.clone(), vault.clone(), request)
        .await
        .expect_err("second move must error");
    assert_eq!(err.code(), "FILE_MOVE_IN_PROGRESS");

    Ok(())
}

#[tokio::test]
async fn move_rolls_back_on_constraint_error() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_conflict";
    seed_household(&pool, household_id).await?;

    let from_category = AttachmentCategory::Bills;
    let to_category = AttachmentCategory::Policies;
    let from_rel = "conflict/original.pdf";
    let to_rel = "conflict/existing.pdf";

    let source_path = attachment_path(&root, household_id, from_category, from_rel);
    std::fs::create_dir_all(source_path.parent().unwrap())?;
    std::fs::write(&source_path, b"conflict-bytes")?;

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(&pool, &bill_id, household_id, from_category, from_rel).await?;

    let file_id = Uuid::now_v7().to_string();
    insert_files_index(
        &pool,
        household_id,
        &file_id,
        from_category,
        PathBuf::from(from_rel)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_ref(),
    )
    .await?;

    // Existing policy row that will conflict with the move target.
    let policy_id = Uuid::now_v7().to_string();
    insert_policy(&pool, &policy_id, household_id, to_category, to_rel).await?;

    let request = FileMoveRequest {
        household_id: household_id.to_string(),
        from_category,
        from_rel: from_rel.to_string(),
        to_category,
        to_rel: to_rel.to_string(),
        conflict: ConflictStrategy::Fail,
    };

    let err = run_file_move(handle.clone(), pool.clone(), vault.clone(), request)
        .await
        .expect_err("move should fail due to unique constraint");
    assert_eq!(err.code(), "SQLITE_CONSTRAINT");

    // Source file should remain intact because rollback restores it.
    assert!(source_path.exists());
    let target_path = attachment_path(&root, household_id, to_category, to_rel);
    assert!(target_path.exists(), "original target file must remain");

    let relative: Option<String> =
        sqlx::query_scalar("SELECT relative_path FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(relative.as_deref(), Some(from_rel));

    Ok(())
}

#[tokio::test]
async fn repair_scan_and_apply_updates_manifest() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_repair";
    seed_household(&pool, household_id).await?;

    let missing_one = "missing/one.pdf";
    let missing_two = "missing/two.pdf";
    let missing_three = "missing/three.pdf";

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(
        &pool,
        &bill_id,
        household_id,
        AttachmentCategory::Bills,
        missing_one,
    )
    .await?;

    let inventory_id = Uuid::now_v7().to_string();
    insert_inventory(&pool, &inventory_id, household_id, missing_two).await?;

    let pet_id = Uuid::now_v7().to_string();
    insert_pet_medical(&pool, &pet_id, household_id, missing_three).await?;

    let scan_request = AttachmentsRepairRequest {
        household_id: household_id.to_string(),
        mode: AttachmentsRepairMode::Scan,
        actions: Vec::new(),
        cancel: false,
    };

    let scan_result =
        run_attachments_repair(handle.clone(), pool.clone(), vault.clone(), scan_request).await?;
    assert_eq!(scan_result.missing, 3);
    assert_eq!(scan_result.scanned, 3);
    assert!(!scan_result.cancelled);

    let manifest_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM missing_attachments WHERE household_id = ?1")
            .bind(household_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(manifest_count, 3);

    let relink_target = attachment_path(
        &root,
        household_id,
        AttachmentCategory::Policies,
        "linked/new.pdf",
    );
    std::fs::create_dir_all(relink_target.parent().unwrap())?;
    std::fs::write(&relink_target, b"linked")?;

    let actions = vec![
        RepairAction {
            table_name: "bills".to_string(),
            row_id: sqlx::query_scalar::<_, i64>("SELECT rowid FROM bills WHERE id = ?1")
                .bind(&bill_id)
                .fetch_one(&pool)
                .await?,
            action: RepairActionKind::Detach,
            new_category: None,
            new_relative_path: None,
        },
        RepairAction {
            table_name: "inventory_items".to_string(),
            row_id: sqlx::query_scalar::<_, i64>("SELECT rowid FROM inventory_items WHERE id = ?1")
                .bind(&inventory_id)
                .fetch_one(&pool)
                .await?,
            action: RepairActionKind::Mark,
            new_category: None,
            new_relative_path: None,
        },
        RepairAction {
            table_name: "pet_medical".to_string(),
            row_id: sqlx::query_scalar::<_, i64>("SELECT rowid FROM pet_medical WHERE id = ?1")
                .bind(&pet_id)
                .fetch_one(&pool)
                .await?,
            action: RepairActionKind::Relink,
            new_category: Some(AttachmentCategory::Policies),
            new_relative_path: Some("linked/new.pdf".to_string()),
        },
    ];

    let apply_request = AttachmentsRepairRequest {
        household_id: household_id.to_string(),
        mode: AttachmentsRepairMode::Apply,
        actions,
        cancel: false,
    };

    let apply_result =
        run_attachments_repair(handle.clone(), pool.clone(), vault.clone(), apply_request).await?;
    assert_eq!(apply_result.repaired, 3);
    assert_eq!(apply_result.missing, 0);
    assert!(!apply_result.cancelled);

    let detach_fields: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT category, relative_path FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(detach_fields.0, None);
    assert_eq!(detach_fields.1, None);

    let mark_entry: (String, i64) = sqlx::query_as(
        "SELECT action, repaired_at_utc FROM missing_attachments WHERE household_id = ?1 AND table_name = 'inventory_items'",
    )
    .bind(household_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(mark_entry.0, "mark");
    assert!(mark_entry.1 > 0);

    let relink_fields: (String, String) =
        sqlx::query_as("SELECT category, relative_path FROM pet_medical WHERE id = ?1")
            .bind(&pet_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(relink_fields.0, AttachmentCategory::Policies.as_str());
    assert_eq!(relink_fields.1, "linked/new.pdf");

    Ok(())
}

#[tokio::test]
async fn repair_manifest_export_writes_csv() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_export";
    seed_household(&pool, household_id).await?;

    let missing_rel = "export/missing.pdf";
    let bill_id = Uuid::now_v7().to_string();
    insert_bill(
        &pool,
        &bill_id,
        household_id,
        AttachmentCategory::Bills,
        missing_rel,
    )
    .await?;

    let scan_request = AttachmentsRepairRequest {
        household_id: household_id.to_string(),
        mode: AttachmentsRepairMode::Scan,
        actions: Vec::new(),
        cancel: false,
    };
    run_attachments_repair(handle.clone(), pool.clone(), vault.clone(), scan_request).await?;

    let manifest_path = run_attachments_repair_manifest_export(
        handle.clone(),
        pool.clone(),
        vault.clone(),
        household_id.to_string(),
    )
    .await?;
    let path = PathBuf::from(&manifest_path);
    assert!(path.exists(), "manifest file exists");
    let contents = std::fs::read_to_string(&path)?;
    assert!(contents.contains("table_name,row_id"));
    assert!(contents.contains("bills"));

    Ok(())
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn move_updates_case_insensitive_on_windows() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_windows";
    seed_household(&pool, household_id).await?;

    let from_category = AttachmentCategory::Bills;
    let to_category = AttachmentCategory::Policies;
    let stored_rel = "Case/Source.PDF";
    let request_rel = stored_rel.to_lowercase();

    let source_path = attachment_path(&root, household_id, from_category, &request_rel);
    std::fs::create_dir_all(source_path.parent().unwrap())?;
    std::fs::write(&source_path, b"case-bytes")?;

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(&pool, &bill_id, household_id, from_category, stored_rel).await?;

    let file_id = Uuid::now_v7().to_string();
    insert_files_index(
        &pool,
        household_id,
        &file_id,
        from_category,
        PathBuf::from(stored_rel)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_ref(),
    )
    .await?;

    let request = FileMoveRequest {
        household_id: household_id.to_string(),
        from_category,
        from_rel: request_rel.clone(),
        to_category,
        to_rel: "Case/Target.pdf".to_string(),
        conflict: ConflictStrategy::Rename,
    };

    let response = run_file_move(handle.clone(), pool.clone(), vault.clone(), request).await?;
    assert!(response.moved >= 2);

    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn move_respects_case_sensitivity_on_unix() -> Result<()> {
    let tmp = tempdir()?;
    let root = tmp.path().join("attachments");
    std::fs::create_dir_all(&root)?;
    let vault = setup_vault(&root);

    let pool = setup_pool().await?;
    let app = tauri::test::mock_app();
    let handle = app.app_handle();

    let household_id = "hh_unix";
    seed_household(&pool, household_id).await?;

    let from_category = AttachmentCategory::Bills;
    let stored_rel = "Case/Source.PDF";
    let request_rel = stored_rel.to_lowercase();

    let source_path = attachment_path(&root, household_id, from_category, &request_rel);
    std::fs::create_dir_all(source_path.parent().unwrap())?;
    std::fs::write(&source_path, b"case-bytes")?;

    let bill_id = Uuid::now_v7().to_string();
    insert_bill(&pool, &bill_id, household_id, from_category, stored_rel).await?;

    let file_id = Uuid::now_v7().to_string();
    insert_files_index(
        &pool,
        household_id,
        &file_id,
        from_category,
        PathBuf::from(stored_rel)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_ref(),
    )
    .await?;

    let request = FileMoveRequest {
        household_id: household_id.to_string(),
        from_category,
        from_rel: request_rel.clone(),
        to_category: AttachmentCategory::Policies,
        to_rel: "Case/Target.pdf".to_string(),
        conflict: ConflictStrategy::Rename,
    };

    let response = run_file_move(handle.clone(), pool.clone(), vault.clone(), request).await?;
    assert_eq!(response.moved, 0);

    let stored_value: Option<String> =
        sqlx::query_scalar("SELECT relative_path FROM bills WHERE id = ?1")
            .bind(&bill_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(stored_value.as_deref(), Some(stored_rel));

    Ok(())
}
