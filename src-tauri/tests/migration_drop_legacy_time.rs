use anyhow::Result;
use arklowdun_lib::migrate;
use include_dir::{include_dir, Dir};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Executor, Row, SqlitePool};

const TARGET_MIGRATION: &str = "0023_events_drop_legacy_time.up.sql";
static MIGRATIONS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../migrations");

async fn setup_pre_migration_schema(pool: &SqlitePool) -> Result<()> {
    pool.execute("PRAGMA foreign_keys=ON;").await?;
    pool.execute(
        "CREATE TABLE household (\
             id TEXT PRIMARY KEY,\
             name TEXT NOT NULL,\
             created_at INTEGER,\
             updated_at INTEGER,\
             deleted_at INTEGER,\
             tz TEXT\
         );",
    )
    .await?;
    pool.execute(
        "CREATE TABLE events (\
             id TEXT PRIMARY KEY,\
             title TEXT NOT NULL,\
             start_at INTEGER NOT NULL,\
             reminder INTEGER,\
             household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,\
             created_at INTEGER NOT NULL,\
             updated_at INTEGER NOT NULL,\
             deleted_at INTEGER,\
             end_at INTEGER,\
             tz TEXT,\
             start_at_utc INTEGER,\
             end_at_utc INTEGER,\
             rrule TEXT,\
             exdates TEXT\
         );",
    )
    .await?;
    pool.execute("CREATE INDEX events_household_start_idx ON events(household_id, start_at);")
        .await?;
    pool.execute(
        "INSERT INTO household (id, name, created_at, updated_at, tz) VALUES ('hh', 'Household', 0, 0, 'UTC');",
    )
    .await?;
    Ok(())
}

async fn prime_prior_migrations(pool: &SqlitePool) -> Result<()> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\
           version   TEXT PRIMARY KEY,\
           applied_at INTEGER NOT NULL\
         )",
    )
    .await?;

    for file in MIGRATIONS_DIR.files() {
        let name = file
            .path()
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if !name.ends_with(".up.sql") {
            continue;
        }
        if name >= TARGET_MIGRATION {
            continue;
        }
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, 0)")
            .bind(name)
            .execute(pool)
            .await?;
    }

    Ok(())
}

async fn run_migration(pool: &SqlitePool) -> Result<()> {
    prime_prior_migrations(pool).await?;
    migrate::apply_migrations(pool).await
}

fn has_column(rows: &[sqlx::sqlite::SqliteRow], name: &str) -> bool {
    rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|c| c == name)
            .unwrap_or(false)
    })
}

#[tokio::test]
async fn migration_backfills_when_start_at_utc_missing_sources_exist() -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;

    setup_pre_migration_schema(&pool).await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, reminder, household_id, created_at, updated_at, end_at, tz, start_at_utc, end_at_utc)\
         VALUES ('evt-start', 'Missing start UTC', 0, NULL, 'hh', 0, 0, NULL, 'UTC', NULL, NULL)",
    )
    .execute(&pool)
    .await?;

    run_migration(&pool).await?;

    let columns = sqlx::query("PRAGMA table_info(events);")
        .fetch_all(&pool)
        .await?;
    assert!(
        !has_column(&columns, "start_at"),
        "start_at should be dropped after successful migration"
    );

    let start_at_utc: i64 =
        sqlx::query_scalar("SELECT start_at_utc FROM events WHERE id='evt-start'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(start_at_utc, 0);
    Ok(())
}

#[tokio::test]
async fn migration_backfills_when_end_at_utc_missing_sources_exist() -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;

    setup_pre_migration_schema(&pool).await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, reminder, household_id, created_at, updated_at, end_at, tz, start_at_utc, end_at_utc)\
         VALUES ('evt-end', 'Missing end UTC', 0, NULL, 'hh', 0, 0, 60000, 'UTC', 0, NULL)",
    )
    .execute(&pool)
    .await?;

    run_migration(&pool).await?;

    let columns = sqlx::query("PRAGMA table_info(events);")
        .fetch_all(&pool)
        .await?;
    assert!(
        !has_column(&columns, "end_at"),
        "end_at should be dropped after successful migration"
    );

    let end_at_utc: i64 = sqlx::query_scalar("SELECT end_at_utc FROM events WHERE id='evt-end'")
        .fetch_one(&pool)
        .await?;
    assert_eq!(end_at_utc, 60_000);
    Ok(())
}

#[tokio::test]
async fn migration_succeeds_when_clean() -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;

    setup_pre_migration_schema(&pool).await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, reminder, household_id, created_at, updated_at, end_at, tz, start_at_utc, end_at_utc, rrule, exdates)\
         VALUES ('evt', 'Clean event', 0, NULL, 'hh', 0, 0, NULL, 'UTC', 0, NULL, NULL, NULL)",
    )
    .execute(&pool)
    .await?;

    run_migration(&pool).await?;

    let columns = sqlx::query("PRAGMA table_info(events);")
        .fetch_all(&pool)
        .await?;
    assert!(
        !has_column(&columns, "start_at"),
        "start_at should be dropped"
    );
    assert!(!has_column(&columns, "end_at"), "end_at should be dropped");
    assert!(has_column(&columns, "start_at_utc"));
    assert!(has_column(&columns, "end_at_utc"));

    let idx_rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='events_household_start_idx'",
    )
    .fetch_all(&pool)
    .await?;
    assert!(idx_rows.is_empty(), "legacy start index must be removed");

    let start_at_utc: i64 = sqlx::query_scalar("SELECT start_at_utc FROM events WHERE id='evt'")
        .fetch_one(&pool)
        .await?;
    assert_eq!(start_at_utc, 0);

    Ok(())
}

#[tokio::test]
async fn migration_backfills_from_legacy_columns() -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;

    setup_pre_migration_schema(&pool).await?;

    sqlx::query(
        "INSERT INTO events (id, title, start_at, reminder, household_id, created_at, updated_at, end_at, tz, start_at_utc, end_at_utc, rrule, exdates)\
         VALUES ('evt-backfill', 'Needs backfill', 1, NULL, 'hh', 0, 0, 61, 'UTC', NULL, NULL, NULL, NULL)",
    )
    .execute(&pool)
    .await?;

    run_migration(&pool).await?;

    let columns = sqlx::query("PRAGMA table_info(events);")
        .fetch_all(&pool)
        .await?;
    assert!(
        !has_column(&columns, "start_at"),
        "start_at should be dropped after backfill"
    );
    assert!(
        !has_column(&columns, "end_at"),
        "end_at should be dropped after backfill"
    );

    let (start_at_utc, end_at_utc): (i64, i64) =
        sqlx::query_as("SELECT start_at_utc, end_at_utc FROM events WHERE id='evt-backfill'")
            .fetch_one(&pool)
            .await?;

    assert_eq!(start_at_utc, 1);
    assert_eq!(end_at_utc, 61);

    Ok(())
}
