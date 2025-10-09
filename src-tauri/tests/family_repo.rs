use anyhow::Result;
use sqlx::SqlitePool;
use tempfile::TempDir;
use uuid::Uuid;

use arklowdun_lib::{
    migrate,
    model_family::{
        AttachmentAddPayload, AttachmentRemovePayload, AttachmentsListRequest,
        RenewalDeletePayload, RenewalInput, RenewalsListRequest, ATTACHMENTS_INVALID_INPUT,
        ATTACHMENTS_INVALID_ROOT, ATTACHMENTS_OUT_OF_VAULT, ATTACHMENTS_PATH_CONFLICT,
        RENEWALS_INVALID_EXPIRY, RENEWALS_INVALID_KIND, RENEWALS_INVALID_LABEL,
        RENEWALS_INVALID_OFFSET, VALIDATION_HOUSEHOLD_MISMATCH, VALIDATION_MEMBER_MISSING,
        VALIDATION_SCOPE_REQUIRED,
    },
    repo_family,
    vault::Vault,
};

#[cfg(unix)]
use arklowdun_lib::model_family::ATTACHMENTS_SYMLINK_REJECTED;

async fn setup() -> Result<(SqlitePool, TempDir, Vault)> {
    let pool = SqlitePool::connect("sqlite::memory:").await?;
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

    let dir = TempDir::new()?;
    let vault = Vault::new(dir.path());
    Ok((pool, dir, vault))
}

#[tokio::test]
async fn attachments_add_and_list_round_trip() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "docs/passport.pdf".into(),
        title: Some("Passport".into()),
        mime_hint: Some("application/pdf".into()),
    };

    let created = repo_family::attachments_add(&pool, &vault, payload.clone()).await?;
    assert_eq!(created.member_id, "mem-1");
    assert_eq!(created.title.as_deref(), Some("Passport"));

    let records = repo_family::attachments_list(
        &pool,
        &AttachmentsListRequest {
            member_id: "mem-1".into(),
        },
    )
    .await?;
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, created.id);
    Ok(())
}

#[tokio::test]
async fn attachments_add_rejects_duplicate_paths() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "docs/id.png".into(),
        title: None,
        mime_hint: None,
    };

    repo_family::attachments_add(&pool, &vault, payload.clone()).await?;
    let err = repo_family::attachments_add(&pool, &vault, payload)
        .await
        .expect_err("duplicate path should fail");
    assert_eq!(err.code(), ATTACHMENTS_PATH_CONFLICT);
    Ok(())
}

#[tokio::test]
async fn attachments_add_rejects_out_of_vault_paths() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "../escape".into(),
        title: None,
        mime_hint: None,
    };

    let err = repo_family::attachments_add(&pool, &vault, payload)
        .await
        .expect_err("path escape should fail");
    assert_eq!(err.code(), ATTACHMENTS_OUT_OF_VAULT);
    Ok(())
}

#[tokio::test]
async fn attachments_add_rejects_invalid_root_key() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "misc".into(),
        relative_path: "docs/id.png".into(),
        title: None,
        mime_hint: None,
    };

    let err = repo_family::attachments_add(&pool, &vault, payload)
        .await
        .expect_err("invalid root should fail");
    assert_eq!(err.code(), ATTACHMENTS_INVALID_ROOT);
    Ok(())
}

#[tokio::test]
async fn attachments_add_rejects_empty_path() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "".into(),
        title: None,
        mime_hint: None,
    };

    let err = repo_family::attachments_add(&pool, &vault, payload)
        .await
        .expect_err("empty path should fail");
    assert_eq!(err.code(), ATTACHMENTS_INVALID_INPUT);
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn attachments_add_rejects_symlinks() -> Result<()> {
    use std::os::unix::fs::symlink;

    let (pool, dir, vault) = setup().await?;

    let attachments_dir = dir.path().join("hh-1").join("misc");
    std::fs::create_dir_all(&attachments_dir)?;
    let target_dir = dir.path().join("external");
    std::fs::create_dir_all(&target_dir)?;
    std::fs::write(target_dir.join("secret.txt"), b"classified")?;
    symlink(&target_dir, attachments_dir.join("docs"))?;

    let payload = AttachmentAddPayload {
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        root_key: "appData".into(),
        relative_path: "docs/secret.txt".into(),
        title: None,
        mime_hint: None,
    };

    let err = repo_family::attachments_add(&pool, &vault, payload)
        .await
        .expect_err("symlink should be rejected");
    assert_eq!(err.code(), ATTACHMENTS_SYMLINK_REJECTED);
    Ok(())
}

#[tokio::test]
async fn attachments_remove_is_idempotent() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    let created = repo_family::attachments_add(
        &pool,
        &vault,
        AttachmentAddPayload {
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            root_key: "appData".into(),
            relative_path: "docs/delete.txt".into(),
            title: None,
            mime_hint: None,
        },
    )
    .await?;

    repo_family::attachments_remove(
        &pool,
        AttachmentRemovePayload {
            id: created.id.to_string(),
        },
    )
    .await?;

    repo_family::attachments_remove(
        &pool,
        AttachmentRemovePayload {
            id: created.id.to_string(),
        },
    )
    .await?;
    Ok(())
}

#[tokio::test]
async fn attachments_list_rejects_missing_member() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let err = repo_family::attachments_list(
        &pool,
        &AttachmentsListRequest {
            member_id: "missing".into(),
        },
    )
    .await
    .expect_err("missing member should fail");
    assert_eq!(err.code(), VALIDATION_MEMBER_MISSING);
    Ok(())
}

#[tokio::test]
async fn attachments_cascade_when_member_removed() -> Result<()> {
    let (pool, _dir, vault) = setup().await?;

    repo_family::attachments_add(
        &pool,
        &vault,
        AttachmentAddPayload {
            household_id: "hh-1".into(),
            member_id: "mem-1".into(),
            root_key: "appData".into(),
            relative_path: "docs/passport.pdf".into(),
            title: None,
            mime_hint: None,
        },
    )
    .await?;

    sqlx::query("DELETE FROM family_members WHERE id = ?")
        .bind("mem-1")
        .execute(&pool)
        .await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_attachments")
        .fetch_one(&pool)
        .await?;

    assert_eq!(count, 0);
    Ok(())
}

fn renewal_input() -> RenewalInput {
    RenewalInput {
        id: None,
        household_id: "hh-1".into(),
        member_id: "mem-1".into(),
        kind: "passport".into(),
        label: Some("Passport".into()),
        expires_at: 1_900_000_000_000,
        remind_on_expiry: true,
        remind_offset_days: 30,
        updated_at: 0,
    }
}

#[tokio::test]
async fn renewals_upsert_validates_kind() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let mut input = renewal_input();
    input.kind = "unknown".into();
    let err = repo_family::renewals_upsert(&pool, input)
        .await
        .expect_err("invalid kind should fail");
    assert_eq!(err.code(), RENEWALS_INVALID_KIND);
    Ok(())
}

#[tokio::test]
async fn renewals_upsert_validates_offset() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let mut input = renewal_input();
    input.remind_offset_days = 999;
    let err = repo_family::renewals_upsert(&pool, input)
        .await
        .expect_err("offset should fail");
    assert_eq!(err.code(), RENEWALS_INVALID_OFFSET);
    Ok(())
}

#[tokio::test]
async fn renewals_upsert_validates_household_membership() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color) \
         VALUES (?1, ?2, 0, 0, NULL, NULL, 0, NULL)",
    )
    .bind("hh-2")
    .bind("Secondary")
    .execute(&pool)
    .await?;

    let mut input = renewal_input();
    input.household_id = "hh-2".into();
    let err = repo_family::renewals_upsert(&pool, input)
        .await
        .expect_err("mismatched household should fail");
    assert_eq!(err.code(), VALIDATION_HOUSEHOLD_MISMATCH);
    Ok(())
}

#[tokio::test]
async fn renewals_upsert_rejects_invalid_expiry() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let mut input = renewal_input();
    input.expires_at = 0;
    let err = repo_family::renewals_upsert(&pool, input)
        .await
        .expect_err("expiry must be positive");
    assert_eq!(err.code(), RENEWALS_INVALID_EXPIRY);
    Ok(())
}

#[tokio::test]
async fn renewals_upsert_rejects_long_labels() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let mut input = renewal_input();
    input.label = Some("x".repeat(101));
    let err = repo_family::renewals_upsert(&pool, input)
        .await
        .expect_err("label too long");
    assert_eq!(err.code(), RENEWALS_INVALID_LABEL);
    Ok(())
}

#[tokio::test]
async fn renewals_list_orders_by_expiry() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let mut first = renewal_input();
    first.id = Some(Uuid::new_v4());
    first.expires_at = 1_800_000_000_000;
    repo_family::renewals_upsert(&pool, first).await?;

    let mut second = renewal_input();
    second.id = Some(Uuid::new_v4());
    second.expires_at = 1_700_000_000_000;
    repo_family::renewals_upsert(&pool, second).await?;

    let rows = repo_family::renewals_list(
        &pool,
        &RenewalsListRequest {
            member_id: Some("mem-1".into()),
            household_id: None,
        },
    )
    .await?;
    assert_eq!(rows.len(), 2);
    assert!(rows[0].expires_at <= rows[1].expires_at);
    Ok(())
}

#[tokio::test]
async fn renewals_delete_is_idempotent() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let created = repo_family::renewals_upsert(&pool, renewal_input()).await?;

    repo_family::renewals_delete(
        &pool,
        RenewalDeletePayload {
            id: created.id.to_string(),
        },
    )
    .await?;

    repo_family::renewals_delete(
        &pool,
        RenewalDeletePayload {
            id: created.id.to_string(),
        },
    )
    .await?;
    Ok(())
}

#[tokio::test]
async fn renewals_list_requires_scope() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let err = repo_family::renewals_list(
        &pool,
        &RenewalsListRequest {
            member_id: None,
            household_id: None,
        },
    )
    .await
    .expect_err("scope required");
    assert_eq!(err.code(), VALIDATION_SCOPE_REQUIRED);
    Ok(())
}

#[tokio::test]
async fn renewals_cascade_when_member_removed() -> Result<()> {
    let (pool, _dir, _vault) = setup().await?;

    let created = repo_family::renewals_upsert(&pool, renewal_input()).await?;

    sqlx::query("DELETE FROM family_members WHERE id = ?")
        .bind("mem-1")
        .execute(&pool)
        .await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_renewals")
        .fetch_one(&pool)
        .await?;

    assert_eq!(count, 0);
    // ensure id was removed from cascade, no stale row
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM member_renewals WHERE id = ?")
        .bind(created.id.to_string())
        .fetch_optional(&pool)
        .await?;

    assert!(exists.is_none());
    Ok(())
}
