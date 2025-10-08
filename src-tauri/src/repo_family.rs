use once_cell::sync::Lazy;
use regex::Regex;
use sqlx::{sqlite::SqliteRow, Error as SqlxError, Row, SqlitePool};
use uuid::Uuid;

use crate::{
    attachment_category::AttachmentCategory,
    model_family::{
        AttachmentAddPayload, AttachmentRemovePayload, AttachmentsListRequest,
        RenewalDeletePayload, RenewalInput, RenewalsListRequest, ALLOWED_ATTACHMENT_ROOTS,
        ATTACHMENTS_INVALID_INPUT, ATTACHMENTS_INVALID_ROOT, ATTACHMENTS_OUT_OF_VAULT,
        ATTACHMENTS_PATH_CONFLICT, ATTACHMENTS_SYMLINK_REJECTED, FAMILY_DECODE_ERROR, GENERIC_FAIL,
        GENERIC_FAIL_MESSAGE, RENEWALS_INVALID_EXPIRY, RENEWALS_INVALID_KIND,
        RENEWALS_INVALID_LABEL, RENEWALS_INVALID_OFFSET, RENEWAL_KINDS,
        VALIDATION_HOUSEHOLD_MISMATCH, VALIDATION_MEMBER_MISSING, VALIDATION_SCOPE_REQUIRED,
    },
    time::now_ms,
    vault::Vault,
    AppError, AppResult,
};

pub use crate::model_family::{AttachmentRef, Renewal};

static MIME_HINT_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^[a-zA-Z0-9._+-]+/[a-zA-Z0-9._+-]+$")
        .expect("mime hint validation pattern to compile")
});

fn map_vault_error(err: AppError) -> AppError {
    let mapped = match err.code() {
        crate::vault::ERR_PATH_OUT_OF_VAULT => AppError::new(
            ATTACHMENTS_OUT_OF_VAULT,
            "That file isn’t stored in the allowed vault area.",
        ),
        crate::vault::ERR_SYMLINK_DENIED => AppError::new(
            ATTACHMENTS_SYMLINK_REJECTED,
            "Symbolic links can’t be attached.",
        ),
        _ => AppError::new(ATTACHMENTS_INVALID_INPUT, err.message().to_string()),
    };

    mapped
        .with_contexts(err.context().iter().map(|(k, v)| (k.clone(), v.clone())))
        .with_cause(err.clone())
}

fn wrap_unexpected(err: AppError, operation: &'static str) -> AppError {
    AppError::new(GENERIC_FAIL, GENERIC_FAIL_MESSAGE)
        .with_context("operation", operation)
        .with_cause(err)
}

fn parse_uuid(value: &str, field: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|err| {
        AppError::new(FAMILY_DECODE_ERROR, format!("Invalid UUID in {field}"))
            .with_context("value", value.to_string())
            .with_context("error", err.to_string())
    })
}

fn validate_root_key(value: &str) -> AppResult<()> {
    if ALLOWED_ATTACHMENT_ROOTS.contains(&value) {
        Ok(())
    } else {
        Err(AppError::new(
            ATTACHMENTS_INVALID_ROOT,
            "Attachments must use the managed vault root.",
        )
        .with_context("root_key", value.to_string()))
    }
}

fn validate_title(title: &Option<String>) -> AppResult<()> {
    if let Some(title) = title {
        if title.chars().count() > 120 {
            return Err(AppError::new(
                ATTACHMENTS_INVALID_INPUT,
                "Attachment titles may be at most 120 characters.",
            )
            .with_context("length", title.chars().count().to_string()));
        }
    }
    Ok(())
}

fn validate_mime_hint(mime: &Option<String>) -> AppResult<()> {
    if let Some(value) = mime {
        if value.is_empty() || !MIME_HINT_PATTERN.is_match(value) {
            return Err(AppError::new(
                ATTACHMENTS_INVALID_INPUT,
                "MIME hints must follow type/subtype syntax.",
            )
            .with_context("mime_hint", value.clone()));
        }
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::new(
            ATTACHMENTS_INVALID_INPUT,
            "Relative paths cannot be empty.",
        ));
    }
    Ok(())
}

fn validate_renewal_kind(kind: &str) -> AppResult<()> {
    if RENEWAL_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(
            AppError::new(RENEWALS_INVALID_KIND, "Renewal type not recognised.")
                .with_context("kind", kind.to_string()),
        )
    }
}

fn validate_offset(offset: i64) -> AppResult<()> {
    if (0..=365).contains(&offset) {
        Ok(())
    } else {
        Err(AppError::new(
            RENEWALS_INVALID_OFFSET,
            "Reminder offset must be between 0 and 365 days.",
        )
        .with_context("offset", offset.to_string()))
    }
}

fn validate_expiry(expires_at: i64) -> AppResult<()> {
    if expires_at > 0 {
        Ok(())
    } else {
        Err(AppError::new(
            RENEWALS_INVALID_EXPIRY,
            "Expiry must be a positive timestamp.",
        ))
    }
}

fn validate_label(label: &Option<String>) -> AppResult<()> {
    if let Some(label) = label {
        if label.chars().count() > 100 {
            return Err(AppError::new(
                RENEWALS_INVALID_LABEL,
                "Renewal labels are limited to 100 characters.",
            )
            .with_context("length", label.chars().count().to_string()));
        }
    }
    Ok(())
}

async fn member_household(pool: &SqlitePool, member_id: &str) -> AppResult<Option<String>> {
    let household: Option<String> =
        sqlx::query_scalar("SELECT household_id FROM family_members WHERE id = ?")
            .bind(member_id)
            .fetch_optional(pool)
            .await
            .map_err(|err| wrap_unexpected(err.into(), "member_lookup"))?;
    Ok(household)
}

async fn ensure_member_in_household(
    pool: &SqlitePool,
    household_id: &str,
    member_id: &str,
) -> AppResult<()> {
    match member_household(pool, member_id).await? {
        Some(found) if found == household_id => Ok(()),
        Some(found) => Err(AppError::new(
            VALIDATION_HOUSEHOLD_MISMATCH,
            "Member belongs to a different household.",
        )
        .with_context("expected", household_id.to_string())
        .with_context("actual", found)
        .with_context("member_id", member_id.to_string())),
        None => Err(
            AppError::new(VALIDATION_MEMBER_MISSING, "Member record not found.")
                .with_context("member_id", member_id.to_string()),
        ),
    }
}

fn deserialize_attachment(row: SqliteRow) -> AppResult<AttachmentRef> {
    let id_str: String = row.get("id");
    let id = parse_uuid(&id_str, "attachment id")?;
    let title: Option<String> = row.try_get("title").ok().flatten();
    let mime_hint: Option<String> = row.try_get("mime_hint").ok().flatten();

    Ok(AttachmentRef {
        id,
        household_id: row.get("household_id"),
        member_id: row.get("member_id"),
        root_key: row.get("root_key"),
        relative_path: row.get("relative_path"),
        title,
        mime_hint,
        added_at: row.get("added_at"),
    })
}

fn deserialize_renewal(row: SqliteRow) -> AppResult<Renewal> {
    let id_str: String = row.get("id");
    let id = parse_uuid(&id_str, "renewal id")?;
    let label: Option<String> = row.try_get("label").ok().flatten();
    let remind_on_expiry: i64 = row.get("remind_on_expiry");

    Ok(Renewal {
        id,
        household_id: row.get("household_id"),
        member_id: row.get("member_id"),
        kind: row.get("kind"),
        label,
        expires_at: row.get("expires_at"),
        remind_on_expiry: remind_on_expiry != 0,
        remind_offset_days: row.get("remind_offset_days"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn attachments_list(
    pool: &SqlitePool,
    request: &AttachmentsListRequest,
) -> AppResult<Vec<AttachmentRef>> {
    if member_household(pool, &request.member_id).await?.is_none() {
        return Err(
            AppError::new(VALIDATION_MEMBER_MISSING, "Member record not found.")
                .with_context("member_id", request.member_id.clone()),
        );
    }

    let rows = sqlx::query(
        "SELECT id, household_id, member_id, root_key, relative_path, title, mime_hint, added_at \
         FROM member_attachments WHERE member_id = ? ORDER BY added_at DESC, id DESC",
    )
    .bind(&request.member_id)
    .fetch_all(pool)
    .await
    .map_err(|err| wrap_unexpected(err.into(), "member_attachments_list"))?;

    rows.into_iter().map(deserialize_attachment).collect()
}

pub async fn attachments_add(
    pool: &SqlitePool,
    vault: &Vault,
    payload: AttachmentAddPayload,
) -> AppResult<AttachmentRef> {
    let AttachmentAddPayload {
        household_id,
        member_id,
        root_key,
        relative_path,
        title,
        mime_hint,
    } = payload;

    validate_root_key(&root_key)?;
    validate_relative_path(&relative_path)?;
    validate_title(&title)?;
    validate_mime_hint(&mime_hint)?;
    ensure_member_in_household(pool, &household_id, &member_id).await?;

    let resolved = vault
        .resolve(&household_id, AttachmentCategory::Misc, &relative_path)
        .map_err(map_vault_error)?;

    let canonical_relative = vault
        .relative_from_resolved(&resolved, &household_id, AttachmentCategory::Misc)
        .unwrap_or(relative_path.clone());

    let added_at = now_ms();
    let id = Uuid::new_v4();
    let id_str = id.to_string();

    let mut tx = pool
        .begin()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_attachments_add_begin"))?;

    sqlx::query(
        "INSERT INTO member_attachments (id, household_id, member_id, title, root_key, relative_path, mime_hint, added_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(&id_str)
    .bind(&household_id)
    .bind(&member_id)
    .bind(&title)
    .bind(&root_key)
    .bind(&canonical_relative)
    .bind(&mime_hint)
    .bind(added_at)
    .execute(&mut tx)
    .await
    .map_err(|err| map_attachment_insert_error(err, &canonical_relative))?;

    let row = sqlx::query(
        "SELECT id, household_id, member_id, root_key, relative_path, title, mime_hint, added_at \
         FROM member_attachments WHERE id = ?",
    )
    .bind(&id_str)
    .fetch_one(&mut tx)
    .await
    .map_err(|err| wrap_unexpected(err.into(), "member_attachments_add_fetch"))?;

    tx.commit()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_attachments_add_commit"))?;

    let mut record = deserialize_attachment(row)?;
    record.title = title;
    record.mime_hint = mime_hint;
    record.added_at = added_at;
    record.id = id;
    Ok(record)
}

pub async fn attachments_remove(
    pool: &SqlitePool,
    payload: AttachmentRemovePayload,
) -> AppResult<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_attachments_remove_begin"))?;

    sqlx::query("DELETE FROM member_attachments WHERE id = ?")
        .bind(&payload.id)
        .execute(&mut tx)
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_attachments_remove"))?;

    tx.commit()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_attachments_remove_commit"))?;
    Ok(())
}

pub async fn renewals_list(
    pool: &SqlitePool,
    request: &RenewalsListRequest,
) -> AppResult<Vec<Renewal>> {
    let (sql, bind_member, bind_household) = if let Some(member_id) = &request.member_id {
        (
            "SELECT id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, updated_at \
             FROM member_renewals WHERE member_id = ? ORDER BY expires_at ASC, id",
            Some(member_id.clone()),
            None,
        )
    } else if let Some(household_id) = &request.household_id {
        (
            "SELECT id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, updated_at \
             FROM member_renewals WHERE household_id = ? ORDER BY expires_at ASC, id",
            None,
            Some(household_id.clone()),
        )
    } else {
        return Err(AppError::new(
            VALIDATION_SCOPE_REQUIRED,
            "A member_id or household_id is required.",
        ));
    };

    let mut query = sqlx::query(sql);
    if let Some(member_id) = bind_member {
        if member_household(pool, &member_id).await?.is_none() {
            return Err(
                AppError::new(VALIDATION_MEMBER_MISSING, "Member record not found.")
                    .with_context("member_id", member_id),
            );
        }
        query = query.bind(member_id);
    } else if let Some(household_id) = bind_household {
        query = query.bind(household_id);
    }

    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_renewals_list"))?;

    rows.into_iter().map(deserialize_renewal).collect()
}

pub async fn renewals_upsert(pool: &SqlitePool, mut input: RenewalInput) -> AppResult<Renewal> {
    validate_renewal_kind(&input.kind)?;
    validate_offset(input.remind_offset_days)?;
    validate_expiry(input.expires_at)?;
    validate_label(&input.label)?;
    ensure_member_in_household(pool, &input.household_id, &input.member_id).await?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_renewals_upsert_begin"))?;

    let id = match input.id {
        Some(id) => {
            if let Some(existing_household) = sqlx::query_scalar::<_, Option<String>>(
                "SELECT household_id FROM member_renewals WHERE id = ?",
            )
            .bind(id.to_string())
            .fetch_optional(&mut tx)
            .await
            .map_err(|err| wrap_unexpected(err.into(), "member_renewals_upsert_lookup"))?
            {
                if let Some(found) = existing_household {
                    if found != input.household_id {
                        tx.rollback().await.ok();
                        return Err(AppError::new(
                            VALIDATION_HOUSEHOLD_MISMATCH,
                            "Renewal belongs to a different household.",
                        )
                        .with_context("id", id.to_string())
                        .with_context("expected", input.household_id.clone())
                        .with_context("actual", found));
                    }
                }
            }
            id
        }
        None => Uuid::new_v4(),
    };

    let now = now_ms();
    let id_str = id.to_string();

    let created_at =
        sqlx::query_scalar::<_, Option<i64>>("SELECT created_at FROM member_renewals WHERE id = ?")
            .bind(&id_str)
            .fetch_optional(&mut tx)
            .await
            .map_err(|err| wrap_unexpected(err.into(), "member_renewals_upsert_created_at"))?
            .unwrap_or(now);

    input.updated_at = now;

    sqlx::query(
        "INSERT OR REPLACE INTO member_renewals \
         (id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )
    .bind(&id_str)
    .bind(&input.household_id)
    .bind(&input.member_id)
    .bind(&input.kind)
    .bind(&input.label)
    .bind(input.expires_at)
    .bind(if input.remind_on_expiry { 1 } else { 0 })
    .bind(input.remind_offset_days)
    .bind(created_at)
    .bind(input.updated_at)
    .execute(&mut tx)
    .await
    .map_err(|err| wrap_unexpected(err.into(), "member_renewals_upsert"))?;

    let row = sqlx::query(
        "SELECT id, household_id, member_id, kind, label, expires_at, remind_on_expiry, remind_offset_days, updated_at \
         FROM member_renewals WHERE id = ?",
    )
    .bind(&id_str)
    .fetch_one(&mut tx)
    .await
    .map_err(|err| wrap_unexpected(err.into(), "member_renewals_upsert_fetch"))?;

    tx.commit()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_renewals_upsert_commit"))?;

    let mut record = deserialize_renewal(row)?;
    record.id = id;
    Ok(record)
}

pub async fn renewals_delete(pool: &SqlitePool, payload: RenewalDeletePayload) -> AppResult<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_renewals_delete_begin"))?;

    sqlx::query("DELETE FROM member_renewals WHERE id = ?")
        .bind(&payload.id)
        .execute(&mut tx)
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_renewals_delete"))?;

    tx.commit()
        .await
        .map_err(|err| wrap_unexpected(err.into(), "member_renewals_delete_commit"))?;
    Ok(())
}

fn map_attachment_insert_error(err: SqlxError, relative: &str) -> AppError {
    if let SqlxError::Database(db) = &err {
        if let Some(constraint) = db.constraint() {
            if constraint == "idx_member_attachments_path" {
                return AppError::new(
                    ATTACHMENTS_PATH_CONFLICT,
                    "That file is already linked to this person.",
                )
                .with_context("relative_path", relative.to_string());
            }
        }
    }
    wrap_unexpected(err.into(), "member_attachments_add")
}
