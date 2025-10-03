use serde::{Deserialize, Serialize};
use sqlx::{Error as SqlxError, Row, SqlitePool};
use thiserror::Error;
use tracing::{info, warn};

use crate::id::new_uuid_v7;
use crate::repo::admin;
use crate::time::now_ms;

// TXN: domain=OUT OF SCOPE tables=household
pub async fn default_household_id(pool: &SqlitePool) -> anyhow::Result<String> {
    if let Some(row) = admin::first_active_for_all_households(pool, "household", None).await? {
        let id: String = row.try_get("id")?;
        return Ok(id);
    }

    let id = new_uuid_v7();
    let now = now_ms();
    sqlx::query(
        "INSERT INTO household (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
    )
        .bind(&id)
        .bind("Default")
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
    Ok(id)
}

pub async fn ensure_household_invariants(pool: &SqlitePool) -> anyhow::Result<()> {
    let (count_default,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM household WHERE is_default = 1")
            .fetch_one(pool)
            .await?;

    if count_default == 0 {
        let kept = sqlx::query_as::<_, (String,)>(
            r#"
            SELECT id FROM household
            WHERE deleted_at IS NULL
            ORDER BY COALESCE(created_at, 0) ASC, id ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(pool)
        .await?;

        if let Some((kept_id,)) = kept {
            let promoted = sqlx::query("UPDATE household SET is_default = 1 WHERE id = ?1")
                .bind(&kept_id)
                .execute(pool)
                .await?;

            if promoted.rows_affected() > 0 {
                info!(
                    target = "arklowdun",
                    event = "household_invariant_repair",
                    action = "promote_default",
                    kept_id = %kept_id
                );
            }
        }
    } else if count_default > 1 {
        let kept = sqlx::query_as::<_, (String,)>(
            r#"
            SELECT id FROM household
            WHERE is_default = 1
            ORDER BY COALESCE(created_at, 0) ASC, id ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(pool)
        .await?;

        let trimmed = sqlx::query(
            r#"
            WITH ranked AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(created_at,0) ASC, id ASC) rn
              FROM household WHERE is_default = 1
            )
            UPDATE household SET is_default = 0 WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
            "#,
        )
        .execute(pool)
        .await?;

        if trimmed.rows_affected() > 0 {
            if let Some((kept_id,)) = kept {
                info!(
                    target = "arklowdun",
                    event = "household_invariant_repair",
                    action = "trim_defaults",
                    kept_id = %kept_id
                );
            } else {
                info!(
                    target = "arklowdun",
                    event = "household_invariant_repair",
                    action = "trim_defaults"
                );
            }
        }
    }

    let cleared = sqlx::query(
        r#"
        UPDATE household
        SET deleted_at = NULL
        WHERE is_default = 1 AND deleted_at IS NOT NULL
        "#,
    )
    .execute(pool)
    .await?;

    if cleared.rows_affected() > 0 {
        info!(
            target = "arklowdun",
            event = "household_invariant_repair",
            action = "clear_soft_deleted_default",
            rows = %cleared.rows_affected()
        );
    }

    Ok(())
}

#[derive(Error, Debug, PartialEq, Eq)]
pub enum HouseholdGuardError {
    #[error("household is soft-deleted")]
    Deleted,
    #[error("household not found")]
    NotFound,
}

pub async fn assert_household_active(
    pool: &SqlitePool,
    id: &str,
) -> std::result::Result<(), HouseholdGuardError> {
    let row = sqlx::query_as(
        "SELECT COUNT(*), SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END)\n         FROM household WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await;

    let row: Option<(i64, Option<i64>)> = match row {
        Ok(value) => value,
        Err(SqlxError::RowNotFound) => None,
        Err(e) => {
            warn!(
                target = "arklowdun",
                event = "household_lookup_error",
                error = %e
            );
            return Err(HouseholdGuardError::NotFound);
        }
    };

    match row {
        Some((0, _)) | None => Err(HouseholdGuardError::NotFound),
        Some((_, Some(del))) if del > 0 => Err(HouseholdGuardError::Deleted),
        Some((_, _)) => Ok(()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct HouseholdRecord {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(default)]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(default)]
    pub updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(default)]
    pub deleted_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(default)]
    pub color: Option<String>,
}

#[derive(Error, Debug)]
pub enum HouseholdCrudError {
    #[error("default household cannot be deleted")]
    DefaultUndeletable,
    #[error("household not found")]
    NotFound,
    #[error("household is soft-deleted")]
    Deleted,
    #[error(transparent)]
    Unexpected(#[from] anyhow::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteOutcome {
    pub was_active: bool,
    pub fallback_id: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct HouseholdStatus {
    id: String,
    is_default: bool,
    deleted_at: Option<i64>,
}

const SELECT_HOUSEHOLD_BASE: &str = r#"
        SELECT id,
               name,
               CASE WHEN is_default = 1 THEN 1 ELSE 0 END AS is_default,
               tz,
               created_at,
               updated_at,
               deleted_at,
               NULL AS color
          FROM household
"#;

async fn fetch_status(pool: &SqlitePool, id: &str) -> Result<HouseholdStatus, HouseholdCrudError> {
    let status = sqlx::query_as::<_, HouseholdStatus>(
        "SELECT id, CASE WHEN is_default = 1 THEN 1 ELSE 0 END AS is_default, deleted_at\n         FROM household WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    status.ok_or(HouseholdCrudError::NotFound)
}

async fn fetch_details(pool: &SqlitePool, id: &str) -> Result<HouseholdRecord, HouseholdCrudError> {
    sqlx::query_as::<_, HouseholdRecord>(&format!("{SELECT_HOUSEHOLD_BASE} WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?
        .ok_or(HouseholdCrudError::NotFound)
}

pub async fn list_households(
    pool: &SqlitePool,
    include_deleted: bool,
) -> Result<Vec<HouseholdRecord>, HouseholdCrudError> {
    let sql = if include_deleted {
        format!("{SELECT_HOUSEHOLD_BASE} ORDER BY is_default DESC, name COLLATE NOCASE, id")
    } else {
        format!(
            "{SELECT_HOUSEHOLD_BASE} WHERE deleted_at IS NULL ORDER BY is_default DESC, name COLLATE NOCASE, id"
        )
    };

    sqlx::query_as::<_, HouseholdRecord>(&sql)
        .fetch_all(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))
}

pub async fn get_household(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<HouseholdRecord>, HouseholdCrudError> {
    sqlx::query_as::<_, HouseholdRecord>(&format!("{SELECT_HOUSEHOLD_BASE} WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))
}

pub async fn create_household(
    pool: &SqlitePool,
    name: &str,
    color: Option<&str>,
) -> Result<HouseholdRecord, HouseholdCrudError> {
    let id = new_uuid_v7();
    let now = now_ms();
    // TODO(Milestone C): persist color to the household row once the UI collects it.
    let _ = color;
    sqlx::query(
        "INSERT INTO household (id, name, is_default, created_at, updated_at, tz) VALUES (?1, ?2, 0, ?3, ?3, NULL)",
    )
    .bind(&id)
    .bind(name)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    info!(target: "arklowdun", event = "household_created", id = %id);
    fetch_details(pool, &id).await
}

pub struct HouseholdUpdateInput<'a> {
    pub name: Option<&'a str>,
    pub color: Option<&'a str>,
}

pub async fn update_household(
    pool: &SqlitePool,
    id: &str,
    input: HouseholdUpdateInput<'_>,
) -> Result<HouseholdRecord, HouseholdCrudError> {
    let status = fetch_status(pool, id).await?;
    if status.deleted_at.is_some() {
        return Err(HouseholdCrudError::Deleted);
    }

    let mut fields = Vec::new();
    let mut binds: Vec<Option<&str>> = Vec::new();

    if let Some(name) = input.name {
        fields.push("name = ?");
        binds.push(Some(name));
    }
    let _ = input.color;

    if fields.is_empty() {
        return fetch_details(pool, id).await;
    }

    fields.push("updated_at = ?");

    let sql = format!("UPDATE household SET {} WHERE id = ?", fields.join(", "));
    let mut query = sqlx::query(&sql);
    for value in binds {
        query = query.bind(value);
    }
    query = query.bind(now_ms());
    query = query.bind(id);

    query
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    info!(target: "arklowdun", event = "household_updated", id = %status.id);
    fetch_details(pool, id).await
}

pub async fn delete_household(
    pool: &SqlitePool,
    id: &str,
    active_id: Option<&str>,
) -> Result<DeleteOutcome, HouseholdCrudError> {
    let status = fetch_status(pool, id).await?;
    if status.is_default {
        return Err(HouseholdCrudError::DefaultUndeletable);
    }
    if status.deleted_at.is_some() {
        return Err(HouseholdCrudError::Deleted);
    }

    let now = now_ms();
    sqlx::query("UPDATE household SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2")
        .bind(now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    let was_active = active_id.map(|candidate| candidate == id).unwrap_or(false);
    let fallback_id = if was_active {
        Some(
            default_household_id(pool)
                .await
                .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?,
        )
    } else {
        None
    };

    info!(
        target: "arklowdun",
        event = "household_deleted",
        id = %status.id,
        was_active
    );

    Ok(DeleteOutcome {
        was_active,
        fallback_id,
    })
}

pub async fn restore_household(
    pool: &SqlitePool,
    id: &str,
) -> Result<HouseholdRecord, HouseholdCrudError> {
    let status = fetch_status(pool, id).await?;
    if status.deleted_at.is_none() {
        return fetch_details(pool, id).await;
    }

    let now = now_ms();
    sqlx::query("UPDATE household SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2")
        .bind(now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    info!(target: "arklowdun", event = "household_restored", id = %status.id);
    fetch_details(pool, id).await
}
