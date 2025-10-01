use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use arklowdun_lib::events_tz_backfill::{
    run_events_backfill, BackfillControl, BackfillOptions, BackfillProgress, BackfillStatus,
    ChunkObserver,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::Row;
use tempfile::tempdir;
use tokio::time::timeout;

type SqlitePool = sqlx::SqlitePool;

async fn setup_pool(path: &std::path::Path) -> Result<SqlitePool> {
    let connect_opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(connect_opts)
        .await?;

    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;

    sqlx::query(
        "CREATE TABLE household (\
             id TEXT PRIMARY KEY,\
             name TEXT NOT NULL,\
             created_at INTEGER NOT NULL,\
             updated_at INTEGER NOT NULL,\
             deleted_at INTEGER\
         )",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE TABLE events (\
             id TEXT PRIMARY KEY,\
             title TEXT NOT NULL,\
             start_at INTEGER NOT NULL,\
             end_at INTEGER,\
             start_at_utc INTEGER,\
             end_at_utc INTEGER,\
             tz TEXT,\
             rrule TEXT,\
             exdates TEXT,\
             household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,\
             created_at INTEGER NOT NULL,\
             updated_at INTEGER NOT NULL,\
             deleted_at INTEGER\
         )",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at)\
         VALUES ('hh', 'Household', 0, 0, NULL)",
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

async fn seed_events(pool: &SqlitePool, count: usize) -> Result<()> {
    let base_ts = 1_700_000_000_000i64;
    for idx in 0..count {
        let id = format!("evt-{idx:04}");
        let start_at = base_ts + (idx as i64) * 3_600_000;
        let end_at = if idx % 2 == 0 {
            Some(start_at + 3_600_000)
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO events (id, title, start_at, end_at, start_at_utc, end_at_utc, tz, rrule, exdates, household_id, created_at, updated_at, deleted_at)\
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, NULL, 'hh', ?5, ?5, NULL)",
        )
        .bind(&id)
        .bind(format!("Event {idx}"))
        .bind(start_at)
        .bind(end_at)
        .bind(start_at)
        .execute(pool)
        .await?;
    }
    Ok(())
}

fn default_options() -> BackfillOptions {
    BackfillOptions {
        household_id: "hh".to_string(),
        default_tz: Some("UTC".to_string()),
        chunk_size: 100,
        progress_interval_ms: 0,
        dry_run: false,
        reset_checkpoint: false,
    }
}

#[tokio::test]
async fn resumes_after_panic_and_persists_progress() -> Result<()> {
    let tmp = tempdir()?;
    let db_path = tmp.path().join("events.sqlite");
    let pool = setup_pool(&db_path).await?;
    seed_events(&pool, 150).await?;

    let panic_once = Arc::new(AtomicBool::new(true));
    let observer_flag = panic_once.clone();
    let observer: ChunkObserver = Arc::new(move |stats| {
        if stats.chunk_index == 1 && observer_flag.swap(false, Ordering::SeqCst) {
            panic!("simulated crash after first chunk");
        }
    });

    let pool_for_task = pool.clone();
    let handle = tokio::spawn(async move {
        let _ = run_events_backfill(
            &pool_for_task,
            default_options(),
            None,
            Some(BackfillControl::new()),
            None,
            Some(observer),
        )
        .await;
    });

    let join_result = timeout(Duration::from_secs(20), handle)
        .await
        .expect("backfill task should complete within timeout");
    let err = join_result.expect_err("backfill task should propagate panic");
    assert!(err.is_panic(), "expected panic join error");

    let checkpoint_row = sqlx::query(
        "SELECT processed, updated, skipped, total, last_rowid FROM events_backfill_checkpoint WHERE household_id='hh'",
    )
    .fetch_one(&pool)
    .await?;
    let processed: i64 = checkpoint_row.get("processed");
    let updated: i64 = checkpoint_row.get("updated");
    let skipped: i64 = checkpoint_row.get("skipped");
    let total: i64 = checkpoint_row.get("total");
    let last_rowid: i64 = checkpoint_row.get("last_rowid");

    assert_eq!(processed, 100, "processed rows should match chunk size");
    assert_eq!(updated, 100, "updated rows should match chunk size");
    assert_eq!(skipped, 0, "no rows should be skipped");
    assert!(total >= 100, "total should include processed rows");
    assert!(
        last_rowid >= 100,
        "checkpoint should advance to first chunk"
    );

    let updated_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE start_at_utc IS NOT NULL")
            .fetch_one(&pool)
            .await?;
    assert_eq!(updated_count, 100, "only first chunk should be persisted");

    let verification_pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&db_path)
                .read_only(true)
                .journal_mode(SqliteJournalMode::Wal)
                .foreign_keys(true),
        )
        .await?;
    let persisted_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE start_at_utc IS NOT NULL")
            .fetch_one(&verification_pool)
            .await?;
    assert_eq!(
        persisted_count, 100,
        "WAL connection should see persisted chunk"
    );
    drop(verification_pool);

    let summary = run_events_backfill(
        &pool,
        default_options(),
        None,
        Some(BackfillControl::new()),
        None,
        None,
    )
    .await?;

    assert_eq!(summary.status, BackfillStatus::Completed);
    assert_eq!(summary.total_scanned, 50);
    assert_eq!(summary.total_updated, 50);
    assert_eq!(summary.total_skipped, 0);

    let final_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE start_at_utc IS NOT NULL")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        final_count, 150,
        "all rows should be backfilled after resume"
    );

    let tz_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE tz='UTC'")
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        tz_count, 150,
        "fallback timezone should be applied to all rows"
    );

    let checkpoint_row = sqlx::query(
        "SELECT processed, updated, skipped, total FROM events_backfill_checkpoint WHERE household_id='hh'",
    )
    .fetch_one(&pool)
    .await?;
    let processed: i64 = checkpoint_row.get("processed");
    let updated: i64 = checkpoint_row.get("updated");
    let skipped: i64 = checkpoint_row.get("skipped");
    let total: i64 = checkpoint_row.get("total");

    assert_eq!(processed, 150);
    assert_eq!(updated, 150);
    assert_eq!(skipped, 0);
    assert_eq!(total, 150);

    Ok(())
}

#[tokio::test]
async fn dry_run_leaves_rows_and_checkpoint_untouched() -> Result<()> {
    let tmp = tempdir()?;
    let db_path = tmp.path().join("events.sqlite");
    let pool = setup_pool(&db_path).await?;
    seed_events(&pool, 25).await?;

    let mut options = default_options();
    options.dry_run = true;

    let summary = run_events_backfill(
        &pool,
        options,
        None,
        Some(BackfillControl::new()),
        None,
        None,
    )
    .await?;

    assert_eq!(summary.status, BackfillStatus::Completed);
    assert_eq!(summary.total_updated, 0);
    assert_eq!(summary.total_skipped, 25);

    let updated_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE start_at_utc IS NOT NULL")
            .fetch_one(&pool)
            .await?;
    assert_eq!(updated_count, 0, "dry run should not persist changes");

    let checkpoint_exists: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events_backfill_checkpoint WHERE household_id='hh'",
    )
    .fetch_optional(&pool)
    .await?;
    assert!(
        checkpoint_exists.is_none(),
        "dry run should not write checkpoint rows",
    );

    Ok(())
}

#[tokio::test]
async fn cancel_mid_run_persists_checkpoint_and_progress_monotonic() -> Result<()> {
    let tmp = tempdir()?;
    let db_path = tmp.path().join("events.sqlite");
    let pool = setup_pool(&db_path).await?;
    seed_events(&pool, 240).await?;

    let mut options = default_options();
    options.chunk_size = 80;
    options.progress_interval_ms = 0;
    let cancel_options = options.clone();

    let control = BackfillControl::new();
    let cancel_switch = Arc::new(AtomicBool::new(false));
    let cancel_observer_flag = cancel_switch.clone();
    let control_for_observer = control.clone();
    let chunk_observer: ChunkObserver = Arc::new(move |stats| {
        if stats.chunk_index >= 2 && !cancel_observer_flag.swap(true, Ordering::SeqCst) {
            control_for_observer.cancel();
        }
    });

    let progress_log: Arc<Mutex<Vec<(u64, u64, u64)>>> = Arc::new(Mutex::new(Vec::new()));
    let progress_sink = progress_log.clone();
    let progress_cb: Arc<dyn Fn(BackfillProgress) + Send + Sync> = Arc::new(move |progress: BackfillProgress| {
        let mut guard = progress_sink.lock().unwrap();
        guard.push((progress.scanned, progress.updated, progress.elapsed_ms));
    });

    let summary = run_events_backfill(
        &pool,
        cancel_options,
        None,
        Some(control.clone()),
        Some(progress_cb),
        Some(chunk_observer),
    )
    .await?;

    assert_eq!(summary.status, BackfillStatus::Cancelled);
    assert!(summary.total_updated > 0);
    assert!(summary.total_updated < summary.total_scanned);

    let checkpoint_row = sqlx::query(
        "SELECT processed, updated, skipped, total, last_rowid FROM events_backfill_checkpoint WHERE household_id='hh'",
    )
    .fetch_one(&pool)
    .await?;
    let processed: i64 = checkpoint_row.get("processed");
    let updated: i64 = checkpoint_row.get("updated");
    let skipped: i64 = checkpoint_row.get("skipped");
    let total: i64 = checkpoint_row.get("total");
    let last_rowid: i64 = checkpoint_row.get("last_rowid");

    assert!(processed > 0 && processed < total);
    assert_eq!(processed, updated);
    assert_eq!(skipped, 0);
    assert!(last_rowid > 0);

    {
        let samples = progress_log.lock().unwrap();
        assert!(
            !samples.is_empty(),
            "backfill progress callback should emit at least one sample"
        );
        for window in samples.windows(2) {
            let (prev_scanned, prev_updated, prev_elapsed) = window[0];
            let (next_scanned, next_updated, next_elapsed) = window[1];
            assert!(next_scanned >= prev_scanned);
            assert!(next_updated >= prev_updated);
            assert!(next_elapsed >= prev_elapsed);
        }
    }

    let resume_summary = run_events_backfill(
        &pool,
        options,
        None,
        Some(BackfillControl::new()),
        None,
        None,
    )
    .await?;

    assert_eq!(resume_summary.status, BackfillStatus::Completed);
    assert_eq!(resume_summary.total_updated, 240);
    assert_eq!(resume_summary.total_skipped, 0);

    Ok(())
}
