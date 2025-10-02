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
