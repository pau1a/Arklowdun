use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use anyhow::Result;
use sqlx::SqlitePool;
use tauri::{App, Manager};
use tempfile::TempDir;
use uuid::Uuid;

use arklowdun_lib::{
    commands_family, db,
    events_tz_backfill::BackfillCoordinator,
    files_indexer::FilesIndexer,
    household_active::StoreHandle,
    migrate,
    model_family::{
        AttachmentAddPayload, AttachmentRemovePayload, AttachmentsListRequest,
        RenewalDeletePayload, RenewalUpsertPayload, RenewalsListRequest, ATTACHMENTS_INVALID_INPUT,
        ATTACHMENTS_INVALID_ROOT, ATTACHMENTS_OUT_OF_VAULT, ATTACHMENTS_PATH_CONFLICT,
        ATTACHMENTS_SYMLINK_REJECTED, GENERIC_FAIL, GENERIC_FAIL_MESSAGE, RENEWALS_INVALID_KIND,
        RENEWALS_INVALID_OFFSET, RENEWALS_PAST_EXPIRY, VALIDATION_HOUSEHOLD_MISMATCH,
        VALIDATION_MEMBER_MISSING,
    },
    vault::Vault,
    vault_migration::VaultMigrationManager,
    AppState,
};

async fn build_app_state(dir: &TempDir) -> Result<(AppState, SqlitePool, PathBuf)> {
    let db_path = dir.path().join("family_ipc.sqlite3");
    let pool = SqlitePool::connect(&format!("sqlite://{}", db_path.display())).await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color) \
         VALUES (?1, ?2, 0, 0, NULL, NULL, 0, NULL)",
    )
    .bind("hh-1")
    .bind("Primary")
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position) \
         VALUES (?1, ?2, ?3, 0, 0, 0)",
    )
    .bind("mem-1")
    .bind("Jane")
    .bind("hh-1")
    .execute(&pool)
    .await?;

    let attachments_root = dir.path().join("attachments");
    std::fs::create_dir_all(&attachments_root)?;
    let vault = Arc::new(Vault::new(&attachments_root));
    let files_indexer = Arc::new(FilesIndexer::new(pool.clone(), vault.clone()));
    let health = db::health::run_health_checks(&pool, &db_path).await?;

    let state = AppState {
        pool: Arc::new(RwLock::new(pool.clone())),
        active_household_id: Arc::new(Mutex::new(String::new())),
        store: StoreHandle::in_memory(),
        backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
        db_health: Arc::new(Mutex::new(health)),
        db_path: Arc::new(db_path.clone()),
        vault,
        vault_migration: Arc::new(VaultMigrationManager::new(&attachments_root)?),
        maintenance: Arc::new(AtomicBool::new(false)),
        files_indexer,
    };

    Ok((state, pool, db_path))
}

fn build_app(state: AppState) -> App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands_family::member_attachments_add,
            commands_family::member_attachments_list,
            commands_family::member_attachments_remove,
            commands_family::member_renewals_list,
            commands_family::member_renewals_upsert,
            commands_family::member_renewals_delete
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build tauri app")
}

#[tokio::test]
async fn member_attachments_add_and_list() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "docs/passport.pdf".into(),
        title: Some("Passport".into()),
        mime_hint: Some("application/pdf".into()),
    };

    let created = commands_family::member_attachments_add(app.state(), payload.clone()).await?;
    assert_eq!(created.member_id, "mem-1");

    let listed = commands_family::member_attachments_list(
        app.state(),
        AttachmentsListRequest {
            member_id: "mem-1".into(),
        },
    )
    .await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);

    commands_family::member_attachments_remove(
        app.state(),
        AttachmentRemovePayload {
            id: created.id.to_string(),
        },
    )
    .await?;
    Ok(())
}

#[tokio::test]
async fn member_attachments_add_rejects_duplicates() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "docs/id.png".into(),
        title: None,
        mime_hint: None,
    };

    commands_family::member_attachments_add(app.state(), payload.clone()).await?;
    let err = commands_family::member_attachments_add(app.state(), payload)
        .await
        .expect_err("duplicate should fail");
    assert_eq!(err.code(), ATTACHMENTS_PATH_CONFLICT);
    Ok(())
}

#[tokio::test]
async fn member_attachments_add_rejects_out_of_vault() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_attachments_add(
        app.state(),
        AttachmentAddPayload {
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            root_key: "appData".into(),
            relative_path: "../escape".into(),
            title: None,
            mime_hint: None,
        },
    )
    .await
    .expect_err("escape attempts should fail");

    assert_eq!(err.code(), ATTACHMENTS_OUT_OF_VAULT);
    Ok(())
}

#[tokio::test]
async fn member_attachments_add_rejects_invalid_root() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_attachments_add(
        app.state(),
        AttachmentAddPayload {
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            root_key: "misc".into(),
            relative_path: "docs/id.png".into(),
            title: None,
            mime_hint: None,
        },
    )
    .await
    .expect_err("invalid root should fail");

    assert_eq!(err.code(), ATTACHMENTS_INVALID_ROOT);
    Ok(())
}

#[tokio::test]
async fn member_attachments_add_rejects_empty_path() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_attachments_add(
        app.state(),
        AttachmentAddPayload {
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            root_key: "appData".into(),
            relative_path: "   ".into(),
            title: None,
            mime_hint: None,
        },
    )
    .await
    .expect_err("blank path should fail");

    assert_eq!(err.code(), ATTACHMENTS_INVALID_INPUT);
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn member_attachments_add_rejects_symlink() -> Result<()> {
    use std::os::unix::fs::symlink;

    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let vault_root = dir.path().join("attachments");
    let household_root = vault_root.join("hh-1").join("misc");
    std::fs::create_dir_all(&household_root)?;
    let external_dir = dir.path().join("external");
    std::fs::create_dir_all(&external_dir)?;
    std::fs::write(external_dir.join("secret.txt"), b"classified")?;
    symlink(&external_dir, household_root.join("docs"))?;

    let err = commands_family::member_attachments_add(
        app.state(),
        AttachmentAddPayload {
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            root_key: "appData".into(),
            relative_path: "docs/secret.txt".into(),
            title: None,
            mime_hint: None,
        },
    )
    .await
    .expect_err("symlinks should fail");

    assert_eq!(err.code(), ATTACHMENTS_SYMLINK_REJECTED);
    Ok(())
}

#[tokio::test]
async fn member_attachments_remove_is_idempotent() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    commands_family::member_attachments_remove(
        app.state(),
        AttachmentRemovePayload {
            id: Uuid::new_v4().to_string(),
        },
    )
    .await?;

    commands_family::member_attachments_remove(
        app.state(),
        AttachmentRemovePayload {
            id: Uuid::new_v4().to_string(),
        },
    )
    .await?;

    Ok(())
}

#[tokio::test]
async fn member_attachments_list_unknown_member() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_attachments_list(
        app.state(),
        AttachmentsListRequest {
            member_id: "missing".into(),
        },
    )
    .await
    .expect_err("missing member should fail");

    assert_eq!(err.code(), VALIDATION_MEMBER_MISSING);
    Ok(())
}

#[tokio::test]
async fn member_renewals_upsert_validation_propagates() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_renewals_upsert(
        app.state(),
        RenewalUpsertPayload {
            id: None,
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            kind: "invalid".into(),
            label: None,
            expires_at: 1_900_000_000_000,
            remind_on_expiry: true,
            remind_offset_days: 10,
        },
    )
    .await
    .expect_err("invalid kind should fail");
    assert_eq!(err.code(), RENEWALS_INVALID_KIND);
    Ok(())
}

#[tokio::test]
async fn member_renewals_upsert_validates_offset() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_renewals_upsert(
        app.state(),
        RenewalUpsertPayload {
            id: None,
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            kind: "passport".into(),
            label: None,
            expires_at: 1_900_000_000_000,
            remind_on_expiry: true,
            remind_offset_days: 999,
        },
    )
    .await
    .expect_err("invalid offset should fail");

    assert_eq!(err.code(), RENEWALS_INVALID_OFFSET);
    Ok(())
}

#[tokio::test]
async fn member_renewals_upsert_validates_household_membership() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color) \
         VALUES (?1, ?2, 0, 0, NULL, NULL, 0, NULL)",
    )
    .bind("hh-2")
    .bind("Secondary")
    .execute(&pool)
    .await?;

    let err = commands_family::member_renewals_upsert(
        app.state(),
        RenewalUpsertPayload {
            id: None,
            household_id: "hh-2".into(),
            member_id: "mem-1".into(),
            kind: "passport".into(),
            label: None,
            expires_at: 1_900_000_000_000,
            remind_on_expiry: true,
            remind_offset_days: 10,
        },
    )
    .await
    .expect_err("household mismatch should fail");

    assert_eq!(err.code(), VALIDATION_HOUSEHOLD_MISMATCH);
    Ok(())
}

#[tokio::test]
async fn member_renewals_list_round_trip() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    commands_family::member_renewals_upsert(
        app.state(),
        RenewalUpsertPayload {
            id: Some(Uuid::new_v4()),
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            kind: "passport".into(),
            label: Some("Passport".into()),
            expires_at: 1_800_000_000_000,
            remind_on_expiry: true,
            remind_offset_days: 30,
        },
    )
    .await?;

    let renewals = commands_family::member_renewals_list(
        app.state(),
        RenewalsListRequest {
            member_id: "mem-1".into(),
            household_id: "hh-1".into(),
        },
    )
    .await?;
    assert_eq!(renewals.len(), 1);
    assert_eq!(renewals[0].kind, "passport");

    commands_family::member_renewals_delete(
        app.state(),
        RenewalDeletePayload {
            id: renewals[0].id.to_string(),
            household_id: "hh-1".into(),
        },
    )
    .await?;

    let remaining = commands_family::member_renewals_list(
        app.state(),
        RenewalsListRequest {
            member_id: "mem-1".into(),
            household_id: "hh-1".into(),
        },
    )
    .await?;
    assert!(remaining.is_empty());

    drop(pool);
    Ok(())
}

#[tokio::test]
async fn member_renewals_list_requires_scope() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    let err = commands_family::member_renewals_list(
        app.state(),
        RenewalsListRequest {
            member_id: "missing".into(),
            household_id: "hh-1".into(),
        },
    )
    .await
    .expect_err("member must exist");

    assert_eq!(err.code(), VALIDATION_MEMBER_MISSING);
    Ok(())
}

#[tokio::test]
async fn member_renewals_delete_is_idempotent() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    commands_family::member_renewals_delete(
        app.state(),
        RenewalDeletePayload {
            id: Uuid::new_v4().to_string(),
            household_id: "hh-1".into(),
        },
    )
    .await?;

    commands_family::member_renewals_delete(
        app.state(),
        RenewalDeletePayload {
            id: Uuid::new_v4().to_string(),
            household_id: "hh-1".into(),
        },
    )
    .await?;

    Ok(())
}

#[tokio::test]
async fn member_attachments_list_wraps_unexpected_errors() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, pool, _db_path) = build_app_state(&dir).await?;
    let app = build_app(state);

    sqlx::query("DROP TABLE member_attachments")
        .execute(&pool)
        .await?;

    let err = commands_family::member_attachments_list(
        app.state(),
        AttachmentsListRequest {
            member_id: "mem-1".into(),
        },
    )
    .await
    .expect_err("schema failure should surface as generic error");

    assert_eq!(err.code(), GENERIC_FAIL);
    assert_eq!(err.message(), GENERIC_FAIL_MESSAGE);
    assert_eq!(
        err.context().get("operation"),
        Some(&"member_attachments_list".to_string())
    );

    Ok(())
}
