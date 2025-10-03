use std::{
    collections::HashSet,
    num::NonZeroU32,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use arklowdun_lib::{
    create_household, delete_household, pending_cascades, resume_household_delete, vacuum_queue,
    CascadeDeleteOptions, CascadeProgress, CascadeProgressObserver,
};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

async fn memory_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    arklowdun_lib::migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

async fn seed_household(pool: &SqlitePool) -> Result<String> {
    let household = create_household(pool, "Cascade", None).await?;
    let category_id = "cat-1";
    sqlx::query(
        "INSERT INTO categories (id, household_id, name, slug, color, position, z, is_visible, created_at, updated_at)\n         VALUES (?1, ?2, 'Errands', 'errands', '#fff', 0, 0, 1, 0, 0)",
    )
    .bind(category_id)
    .bind(&household.id)
    .execute(pool)
    .await?;
    let note_id = "note-1";
    sqlx::query(
        "INSERT INTO notes (id, household_id, category_id, position, created_at, updated_at, text, color, x, y)\n         VALUES (?1, ?2, ?3, 0, 0, 0, 'Task', '#fff', 0, 0)",
    )
    .bind(note_id)
    .bind(&household.id)
    .bind(category_id)
    .execute(pool)
    .await?;
    let event_id = "evt-1";
    sqlx::query(
        "INSERT INTO events (id, title, household_id, created_at, updated_at, start_at_utc)\n         VALUES (?1, 'Appt', ?2, 0, 0, 0)",
    )
    .bind(event_id)
    .bind(&household.id)
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO note_links (id, household_id, note_id, entity_type, entity_id, relation, created_at, updated_at)\n         VALUES ('link-1', ?1, ?2, 'event', ?3, 'attached_to', 0, 0)",
    )
    .bind(&household.id)
    .bind(note_id)
    .bind(event_id)
    .execute(pool)
    .await?;
    Ok(household.id)
}

fn progress_collector() -> (CascadeProgressObserver, Arc<Mutex<Vec<CascadeProgress>>>) {
    let records: Arc<Mutex<Vec<CascadeProgress>>> = Arc::new(Mutex::new(Vec::new()));
    let observer_records = records.clone();
    let observer: CascadeProgressObserver = Arc::new(move |progress: CascadeProgress| {
        observer_records.lock().unwrap().push(progress);
    });
    (observer, records)
}

async fn table_count(pool: &SqlitePool, table: &str, household_id: &str) -> Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE household_id = ?1");
    let count: i64 = sqlx::query_scalar(&sql)
        .bind(household_id)
        .fetch_one(pool)
        .await?;
    Ok(count)
}

#[tokio::test]
async fn cascade_deletes_related_rows_and_queues_vacuum() -> Result<()> {
    let pool = memory_pool().await?;
    let household_id = seed_household(&pool).await?;
    let (observer, records) = progress_collector();
    let mut options = CascadeDeleteOptions::default();
    options.chunk_size = NonZeroU32::new(1).unwrap();
    options.progress = Some(observer);

    let outcome = delete_household(&pool, &household_id, None, options).await?;
    assert!(outcome.total_deleted >= 4);
    assert!(outcome.vacuum_recommended);
    assert!(outcome.completed);

    assert_eq!(table_count(&pool, "notes", &household_id).await?, 0);
    assert_eq!(table_count(&pool, "events", &household_id).await?, 0);
    assert_eq!(table_count(&pool, "note_links", &household_id).await?, 0);

    let progress = records.lock().unwrap();
    assert!(progress.iter().any(|p| p.phase == "notes"));
    assert!(progress.iter().any(|p| p.phase == "events"));

    let queue = vacuum_queue(&pool).await?;
    assert!(queue.iter().any(|entry| entry.household_id == household_id));

    let cascades = pending_cascades(&pool).await?;
    assert!(cascades.is_empty());

    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM household WHERE id = ?1")
        .bind(&household_id)
        .fetch_optional(&pool)
        .await?;
    assert!(exists.is_none());
    Ok(())
}

#[tokio::test]
async fn resume_household_delete_completes_from_checkpoint() -> Result<()> {
    let pool = memory_pool().await?;
    let household_id = seed_household(&pool).await?;

    // Ensure cascade tables exist.
    let _ = pending_cascades(&pool).await?;
    sqlx::query("UPDATE household SET deleted_at = 1, updated_at = 1 WHERE id = ?1")
        .bind(&household_id)
        .execute(&pool)
        .await?;

    let total = table_count(&pool, "note_links", &household_id).await?
        + table_count(&pool, "notes", &household_id).await?
        + table_count(&pool, "events", &household_id).await?
        + table_count(&pool, "categories", &household_id).await?
        + 1; // household row

    sqlx::query(
        "INSERT INTO cascade_checkpoints (household_id, phase_index, deleted_count, total, phase, updated_at, vacuum_pending)\n         VALUES (?1, 0, 0, ?2, 'note_links', 1, 0)",
    )
    .bind(&household_id)
    .bind(total)
    .execute(&pool)
    .await?;

    let (observer, records) = progress_collector();
    let mut options = CascadeDeleteOptions::default();
    options.chunk_size = NonZeroU32::new(1).unwrap();
    options.progress = Some(observer);
    let outcome = resume_household_delete(&pool, &household_id, None, options).await?;
    assert!(outcome.total_deleted >= 4);
    assert!(outcome.completed);

    assert_eq!(table_count(&pool, "notes", &household_id).await?, 0);
    assert_eq!(table_count(&pool, "events", &household_id).await?, 0);
    assert_eq!(table_count(&pool, "categories", &household_id).await?, 0);

    let progress = records.lock().unwrap();
    assert!(progress.iter().any(|p| p.phase == "note_links"));

    let cascades = pending_cascades(&pool).await?;
    assert!(cascades.is_empty());
    Ok(())
}

#[tokio::test]
async fn cascade_pause_emits_paused_progress() -> Result<()> {
    let pool = memory_pool().await?;
    let household_id = seed_household(&pool).await?;
    let (observer, records) = progress_collector();
    let mut options = CascadeDeleteOptions::default();
    options.chunk_size = NonZeroU32::new(1).unwrap();
    options.progress = Some(observer);
    options.max_duration_ms = Some(0);

    let outcome = delete_household(&pool, &household_id, None, options).await?;
    assert!(!outcome.completed);
    assert!(!outcome.vacuum_recommended);

    let progress = records.lock().unwrap();
    assert!(progress.iter().any(|p| p.phase == "paused"));

    let cascades = pending_cascades(&pool).await?;
    assert_eq!(cascades.len(), 1);

    let (resume_observer, resume_records) = progress_collector();
    let mut resume_options = CascadeDeleteOptions::default();
    resume_options.chunk_size = NonZeroU32::new(1).unwrap();
    resume_options.progress = Some(resume_observer);
    resume_options.resume = true;

    let resumed = resume_household_delete(&pool, &household_id, None, resume_options).await?;
    assert!(resumed.completed);
    assert!(resumed.vacuum_recommended);

    let resumed_progress = resume_records.lock().unwrap();
    assert!(resumed_progress.iter().any(|p| p.phase == "household"));

    let cascades = pending_cascades(&pool).await?;
    assert!(cascades.is_empty());
    Ok(())
}

#[tokio::test]
async fn cascade_phase_registry_covers_household_tables() -> Result<()> {
    let pool = memory_pool().await?;
    let known: HashSet<_> = arklowdun_lib::cascade_phase_tables()
        .into_iter()
        .collect();
    let tables = sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(&pool)
    .await?;

    let mut uncovered = Vec::new();
    for table in tables {
        if matches!(
            table.as_str(),
            "household" | "cascade_checkpoints" | "cascade_vacuum_queue" | "shadow_read_audit"
        ) {
            continue;
        }
        let info_sql = format!(
            "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE lower(name) = 'household_id'"
        );
        let has_household: i64 = sqlx::query_scalar(&info_sql).fetch_one(&pool).await?;
        if has_household > 0 && !known.contains(table.as_str()) {
            uncovered.push(table);
        }
    }

    assert!(
        uncovered.is_empty(),
        "missing cascade phases for tables: {:?}",
        uncovered
    );

    Ok(())
}
