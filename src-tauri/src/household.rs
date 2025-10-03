use serde::{Deserialize, Serialize};
use sqlx::{Error as SqlxError, Executor, Row, Sqlite, SqlitePool};
use thiserror::Error;
use tracing::{info, warn};

use std::num::NonZeroU32;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::time::{Duration, Instant};

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
    pub total_deleted: u64,
    pub total_expected: u64,
    pub vacuum_recommended: bool,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CascadeProgress {
    pub household_id: String,
    pub deleted: u64,
    pub total: u64,
    pub phase: String,
    pub phase_index: usize,
    pub phase_total: usize,
}

pub type CascadeProgressObserver = Arc<dyn Fn(CascadeProgress) + Send + Sync + 'static>;

#[derive(Debug, Clone)]
pub struct CascadeDeleteOptions {
    pub chunk_size: NonZeroU32,
    pub progress: Option<CascadeProgressObserver>,
    pub resume: bool,
    pub max_duration_ms: Option<u64>,
    pub cancel_flag: Option<Arc<AtomicBool>>,
}

impl Default for CascadeDeleteOptions {
    fn default() -> Self {
        Self {
            chunk_size: NonZeroU32::new(750).expect("non zero chunk size"),
            progress: None,
            resume: false,
            max_duration_ms: None,
            cancel_flag: None,
        }
    }
}

#[derive(Debug, Clone)]
struct CascadePhase {
    name: &'static str,
    table: &'static str,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct CascadeCheckpoint {
    household_id: String,
    phase_index: i64,
    deleted_count: i64,
    total: i64,
    phase: String,
    updated_at: i64,
    vacuum_pending: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VacuumQueueEntry {
    pub household_id: String,
    pub requested_at: i64,
}

const CASCADE_PHASES: &[CascadePhase] = &[
    CascadePhase {
        name: "note_links",
        table: "note_links",
    },
    CascadePhase {
        name: "notes",
        table: "notes",
    },
    CascadePhase {
        name: "events",
        table: "events",
    },
    CascadePhase {
        name: "files_index",
        table: "files_index",
    },
    CascadePhase {
        name: "files_index_meta",
        table: "files_index_meta",
    },
    CascadePhase {
        name: "expenses",
        table: "expenses",
    },
    CascadePhase {
        name: "bills",
        table: "bills",
    },
    CascadePhase {
        name: "inventory_items",
        table: "inventory_items",
    },
    CascadePhase {
        name: "pet_medical",
        table: "pet_medical",
    },
    CascadePhase {
        name: "vehicle_maintenance",
        table: "vehicle_maintenance",
    },
    CascadePhase {
        name: "policies",
        table: "policies",
    },
    CascadePhase {
        name: "property_documents",
        table: "property_documents",
    },
    CascadePhase {
        name: "shopping_items",
        table: "shopping_items",
    },
    CascadePhase {
        name: "family_members",
        table: "family_members",
    },
    CascadePhase {
        name: "vehicles",
        table: "vehicles",
    },
    CascadePhase {
        name: "pets",
        table: "pets",
    },
    CascadePhase {
        name: "budget_categories",
        table: "budget_categories",
    },
    CascadePhase {
        name: "categories",
        table: "categories",
    },
];

pub fn cascade_phase_tables() -> Vec<&'static str> {
    CASCADE_PHASES.iter().map(|phase| phase.table).collect()
}

const CASCADE_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS cascade_checkpoints (
    household_id TEXT PRIMARY KEY,
    phase_index INTEGER NOT NULL,
    deleted_count INTEGER NOT NULL,
    total INTEGER NOT NULL,
    phase TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    vacuum_pending INTEGER NOT NULL DEFAULT 0
);
"#;

const VACUUM_QUEUE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS cascade_vacuum_queue (
    household_id TEXT PRIMARY KEY,
    requested_at INTEGER NOT NULL
);
"#;

#[derive(Debug, sqlx::FromRow)]
struct HouseholdStatus {
    id: String,
    name: String,
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
        "SELECT id, name, CASE WHEN is_default = 1 THEN 1 ELSE 0 END AS is_default, deleted_at\n         FROM household WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    status.ok_or(HouseholdCrudError::NotFound)
}

async fn ensure_cascade_tables(pool: &SqlitePool) -> Result<(), HouseholdCrudError> {
    sqlx::query(CASCADE_TABLE_SQL)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    let has_fk_constraint = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pragma_foreign_key_list('cascade_vacuum_queue')",
    )
    .fetch_one(pool)
    .await
    {
        Ok(count) => count > 0,
        Err(_) => false,
    };
    if has_fk_constraint {
        sqlx::query("DROP TABLE IF EXISTS cascade_vacuum_queue")
            .execute(pool)
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    }
    sqlx::query(VACUUM_QUEUE_SQL)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(())
}

async fn load_checkpoint(
    pool: &SqlitePool,
    household_id: &str,
) -> Result<Option<CascadeCheckpoint>, HouseholdCrudError> {
    let checkpoint = sqlx::query_as::<_, CascadeCheckpoint>(
        "SELECT household_id, phase_index, deleted_count, total, phase, updated_at, vacuum_pending\n         FROM cascade_checkpoints WHERE household_id = ?1",
    )
    .bind(household_id)
    .fetch_optional(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(checkpoint)
}

async fn save_checkpoint<'e, E>(
    executor: &mut E,
    checkpoint: &CascadeCheckpoint,
) -> Result<(), HouseholdCrudError>
where
    E: Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO cascade_checkpoints (household_id, phase_index, deleted_count, total, phase, updated_at, vacuum_pending)\n             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)\n             ON CONFLICT(household_id) DO UPDATE SET\n                 phase_index = excluded.phase_index,\n                 deleted_count = excluded.deleted_count,\n                 total = excluded.total,\n                 phase = excluded.phase,\n                 updated_at = excluded.updated_at,\n                 vacuum_pending = excluded.vacuum_pending",
    )
    .bind(&checkpoint.household_id)
    .bind(checkpoint.phase_index)
    .bind(checkpoint.deleted_count)
    .bind(checkpoint.total)
    .bind(&checkpoint.phase)
    .bind(checkpoint.updated_at)
    .bind(checkpoint.vacuum_pending)
    .execute(executor)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(())
}

async fn clear_checkpoint(pool: &SqlitePool, household_id: &str) -> Result<(), HouseholdCrudError> {
    sqlx::query("DELETE FROM cascade_checkpoints WHERE household_id = ?1")
        .bind(household_id)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(())
}

async fn enqueue_vacuum(pool: &SqlitePool, household_id: &str) -> Result<(), HouseholdCrudError> {
    sqlx::query(
        "INSERT OR REPLACE INTO cascade_vacuum_queue (household_id, requested_at) VALUES (?1, ?2)",
    )
    .bind(household_id)
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(())
}

async fn compute_total_rows(
    pool: &SqlitePool,
    household_id: &str,
) -> Result<i64, HouseholdCrudError> {
    let mut total = 1i64; // account for household row
    for phase in CASCADE_PHASES {
        let sql = format!(
            "SELECT COUNT(*) FROM {} WHERE household_id = ?1",
            phase.table
        );
        let count: i64 = sqlx::query_scalar(&sql)
            .bind(household_id)
            .fetch_one(pool)
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
        total += count;
    }
    Ok(total)
}

fn emit_progress(progress: &Option<CascadeProgressObserver>, payload: CascadeProgress) {
    info!(
        target: "arklowdun",
        event = "household_delete_progress",
        household_id = %payload.household_id,
        deleted = payload.deleted,
        total = payload.total,
        phase = %payload.phase,
        phase_index = payload.phase_index,
        phase_total = payload.phase_total,
    );
    if let Some(handler) = progress {
        handler(payload);
    }
}

fn should_pause(start: &Instant, options: &CascadeDeleteOptions) -> bool {
    if let Some(flag) = &options.cancel_flag {
        if flag.load(Ordering::Relaxed) {
            return true;
        }
    }
    if let Some(limit) = options.max_duration_ms {
        if limit == 0 || start.elapsed() >= Duration::from_millis(limit) {
            return true;
        }
    }
    false
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

    fetch_details(pool, id).await
}

pub async fn delete_household(
    pool: &SqlitePool,
    id: &str,
    active_id: Option<&str>,
    mut options: CascadeDeleteOptions,
) -> Result<DeleteOutcome, HouseholdCrudError> {
    ensure_cascade_tables(pool).await?;

    let status = fetch_status(pool, id).await?;
    if status.is_default {
        warn!(
            target: "arklowdun",
            event = "household_delete_failed",
            id = %status.id,
            name = %status.name,
            reason = "default"
        );
        return Err(HouseholdCrudError::DefaultUndeletable);
    }

    let mut checkpoint = load_checkpoint(pool, id).await?;
    let resume_requested = options.resume || checkpoint.is_some();

    if status.deleted_at.is_some() && !resume_requested {
        warn!(
            target: "arklowdun",
            event = "household_delete_failed",
            id = %status.id,
            name = %status.name,
            reason = "already_deleted"
        );
        return Err(HouseholdCrudError::Deleted);
    }

    if checkpoint.is_none() {
        let now = now_ms();
        sqlx::query("UPDATE household SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

        let total = compute_total_rows(pool, id).await?;
        let initial_phase = CASCADE_PHASES
            .first()
            .map(|phase| phase.name)
            .unwrap_or("household");
        checkpoint = Some(CascadeCheckpoint {
            household_id: id.to_string(),
            phase_index: 0,
            deleted_count: 0,
            total,
            phase: initial_phase.to_string(),
            updated_at: now,
            vacuum_pending: 0,
        });

        let mut tx = pool
            .begin()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
        save_checkpoint(&mut tx, checkpoint.as_ref().unwrap()).await?;
        tx.commit()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    }

    let mut checkpoint = checkpoint.expect("checkpoint ensured above");
    let mut total_deleted = checkpoint.deleted_count.max(0) as u64;
    let total_expected = checkpoint.total.max(0) as u64;

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

    let mut phase_index = checkpoint.phase_index.max(0) as usize;
    let chunk_size = options.chunk_size.get() as i64;
    let phase_total = CASCADE_PHASES.len() + 1;
    let mut paused = false;
    let start_time = Instant::now();

    while phase_index < CASCADE_PHASES.len() {
        let phase = &CASCADE_PHASES[phase_index];
        if should_pause(&start_time, &options) {
            paused = true;
            checkpoint.phase = phase.name.to_string();
            break;
        }

        checkpoint.phase_index = phase_index as i64;
        checkpoint.phase = phase.name.to_string();
        checkpoint.updated_at = now_ms();

        {
            let mut tx = pool
                .begin()
                .await
                .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
            save_checkpoint(&mut tx, &checkpoint).await?;
            tx.commit()
                .await
                .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
        }

        loop {
            if should_pause(&start_time, &options) {
                paused = true;
                break;
            }

            let mut tx = pool
                .begin()
                .await
                .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
            let sql = format!(
                "DELETE FROM {table} WHERE rowid IN (SELECT rowid FROM {table} WHERE household_id = ?1 LIMIT ?2)",
                table = phase.table
            );
            let affected = sqlx::query(&sql)
                .bind(id)
                .bind(chunk_size)
                .execute(&mut tx)
                .await
                .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
            let rows = affected.rows_affected() as i64;
            let now = now_ms();

            if rows > 0 {
                checkpoint.deleted_count += rows;
                total_deleted = checkpoint.deleted_count.max(0) as u64;
            }
            checkpoint.updated_at = now;
            save_checkpoint(&mut tx, &checkpoint).await?;
            tx.commit()
                .await
                .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

            if rows > 0 {
                let phase_number = phase_index + 1;
                emit_progress(
                    &options.progress,
                    CascadeProgress {
                        household_id: id.to_string(),
                        deleted: total_deleted,
                        total: total_expected,
                        phase: phase.name.to_string(),
                        phase_index: phase_number,
                        phase_total,
                    },
                );
            }

            if rows == 0 || rows < chunk_size {
                break;
            }
        }

        if paused {
            break;
        }

        phase_index += 1;
        checkpoint.phase_index = phase_index as i64;
        checkpoint.updated_at = now_ms();
        let mut tx = pool
            .begin()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
        save_checkpoint(&mut tx, &checkpoint).await?;
        tx.commit()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    }

    if paused {
        checkpoint.updated_at = now_ms();
        let mut tx = pool
            .begin()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
        save_checkpoint(&mut tx, &checkpoint).await?;
        tx.commit()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

        let phase_number = phase_index.min(CASCADE_PHASES.len()) + 1;
        emit_progress(
            &options.progress,
            CascadeProgress {
                household_id: id.to_string(),
                deleted: total_deleted,
                total: total_expected,
                phase: "paused".to_string(),
                phase_index: phase_number,
                phase_total,
            },
        );

        return Ok(DeleteOutcome {
            was_active,
            fallback_id,
            total_deleted,
            total_expected,
            vacuum_recommended: false,
            completed: false,
        });
    }

    if should_pause(&start_time, &options) {
        checkpoint.phase_index = CASCADE_PHASES.len() as i64;
        checkpoint.phase = "household".to_string();
        checkpoint.updated_at = now_ms();
        let mut tx = pool
            .begin()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
        save_checkpoint(&mut tx, &checkpoint).await?;
        tx.commit()
            .await
            .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

        emit_progress(
            &options.progress,
            CascadeProgress {
                household_id: id.to_string(),
                deleted: total_deleted,
                total: total_expected,
                phase: "paused".to_string(),
                phase_index: phase_total,
                phase_total,
            },
        );

        return Ok(DeleteOutcome {
            was_active,
            fallback_id,
            total_deleted,
            total_expected,
            vacuum_recommended: false,
            completed: false,
        });
    }

    checkpoint.phase_index = CASCADE_PHASES.len() as i64;
    checkpoint.phase = "household".to_string();
    checkpoint.updated_at = now_ms();

    let mut tx = pool
        .begin()
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    let affected = sqlx::query("DELETE FROM household WHERE id = ?1")
        .bind(id)
        .execute(&mut tx)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    let rows = affected.rows_affected() as i64;
    if rows > 0 {
        checkpoint.deleted_count += rows;
        total_deleted = checkpoint.deleted_count.max(0) as u64;
    }
    checkpoint.updated_at = now_ms();
    save_checkpoint(&mut tx, &checkpoint).await?;
    tx.commit()
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    if rows > 0 {
        emit_progress(
            &options.progress,
            CascadeProgress {
                household_id: id.to_string(),
                deleted: total_deleted,
                total: total_expected,
                phase: "household".to_string(),
                phase_index: phase_total,
                phase_total,
            },
        );
    }

    enqueue_vacuum(pool, id).await?;
    clear_checkpoint(pool, id).await?;

    Ok(DeleteOutcome {
        was_active,
        fallback_id,
        total_deleted,
        total_expected,
        vacuum_recommended: true,
        completed: true,
    })
}

pub async fn restore_household(
    pool: &SqlitePool,
    id: &str,
) -> Result<HouseholdRecord, HouseholdCrudError> {
    let status = fetch_status(pool, id).await?;
    if status.deleted_at.is_none() {
        info!(
            target: "arklowdun",
            event = "household_restore_skipped",
            id = %status.id,
            name = %status.name
        );
        return fetch_details(pool, id).await;
    }

    let now = now_ms();
    sqlx::query("UPDATE household SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2")
        .bind(now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;

    fetch_details(pool, id).await
}

pub async fn resume_household_delete(
    pool: &SqlitePool,
    id: &str,
    active_id: Option<&str>,
    mut options: CascadeDeleteOptions,
) -> Result<DeleteOutcome, HouseholdCrudError> {
    options.resume = true;
    delete_household(pool, id, active_id, options).await
}

pub async fn pending_cascades(
    pool: &SqlitePool,
) -> Result<Vec<CascadeCheckpoint>, HouseholdCrudError> {
    ensure_cascade_tables(pool).await?;
    let checkpoints = sqlx::query_as::<_, CascadeCheckpoint>(
        "SELECT household_id, phase_index, deleted_count, total, phase, updated_at, vacuum_pending\n         FROM cascade_checkpoints",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(checkpoints)
}

pub async fn vacuum_queue(pool: &SqlitePool) -> Result<Vec<VacuumQueueEntry>, HouseholdCrudError> {
    ensure_cascade_tables(pool).await?;
    let entries = sqlx::query_as::<_, VacuumQueueEntry>(
        "SELECT household_id, requested_at FROM cascade_vacuum_queue ORDER BY requested_at ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(entries)
}

pub async fn acknowledge_vacuum(
    pool: &SqlitePool,
    household_id: &str,
) -> Result<(), HouseholdCrudError> {
    ensure_cascade_tables(pool).await?;
    sqlx::query("DELETE FROM cascade_vacuum_queue WHERE household_id = ?1")
        .bind(household_id)
        .execute(pool)
        .await
        .map_err(|err| HouseholdCrudError::Unexpected(err.into()))?;
    Ok(())
}
