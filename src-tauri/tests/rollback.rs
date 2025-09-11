use anyhow::{Context, Result};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::{fs, path::PathBuf};
use tempfile::tempdir;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn migrations_dir() -> PathBuf {
    crate_dir().join("../migrations")
}

fn list_up_versions() -> Result<Vec<String>> {
    let dir = migrations_dir();
    let mut ups = fs::read_dir(&dir)
        .with_context(|| format!("read_dir({})", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "sql").unwrap_or(false))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with(".up.sql") && !n.starts_with('_'))
                .unwrap_or(false)
        })
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    ups.sort();
    Ok(ups)
}

async fn assert_table_exists(pool: &SqlitePool, name: &str) -> Result<()> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;")
            .bind(name)
            .fetch_optional(pool)
            .await?;
    assert!(exists.is_some(), "expected table `{name}`");
    Ok(())
}

async fn assert_index_exists(pool: &SqlitePool, name: &str) -> Result<()> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?;")
            .bind(name)
            .fetch_optional(pool)
            .await?;
    assert!(exists.is_some(), "expected index `{name}`");
    Ok(())
}

async fn assert_fk_and_integrity_ok(pool: &SqlitePool) -> Result<()> {
    let fk_on: i64 = sqlx::query_scalar("PRAGMA foreign_keys;")
        .fetch_one(pool)
        .await?;
    assert_eq!(fk_on, 1, "PRAGMA foreign_keys must be ON");
    let fk_rows = sqlx::query("PRAGMA foreign_key_check;")
        .fetch_all(pool)
        .await?;
    assert!(fk_rows.is_empty(), "foreign_key_check reported violations");
    let ok: String = sqlx::query_scalar("PRAGMA integrity_check;")
        .fetch_one(pool)
        .await?;
    assert_eq!(ok, "ok", "integrity_check must be ok, got: {ok}");
    Ok(())
}

async fn user_tables(pool: &SqlitePool) -> Result<Vec<String>> {
    let names: Vec<String> = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    )
    .map(|row: sqlx::sqlite::SqliteRow| row.get("name"))
    .fetch_all(pool)
    .await?;
    Ok(names)
}

async fn user_indexes(pool: &SqlitePool) -> Result<Vec<String>> {
    let names: Vec<String> = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';",
    )
    .map(|row: sqlx::sqlite::SqliteRow| row.get("name"))
    .fetch_all(pool)
    .await?;
    Ok(names)
}

#[tokio::test]
async fn rollback_all_migrations_leaves_clean_db() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("rollback.sqlite");
    let url = format!("sqlite://{}?mode=rwc", db_path.display());

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .context("connect sqlite")?;
    sqlx::query("PRAGMA journal_mode=WAL;")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous=NORMAL;")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;

    let jm: String = sqlx::query_scalar("PRAGMA journal_mode;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(jm.to_lowercase(), "wal", "journal_mode must be WAL");
    let fk_on: i64 = sqlx::query_scalar("PRAGMA foreign_keys;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(fk_on, 1, "PRAGMA foreign_keys must be ON");

    arklowdun_lib::migrate::apply_migrations(&pool)
        .await
        .context("apply_migrations")?;

    for t in ["schema_migrations", "household", "events", "notes"] {
        assert_table_exists(&pool, t).await?;
    }
    assert_index_exists(&pool, "events_household_start_at_utc_idx").await?;
    assert_fk_and_integrity_ok(&pool).await?;

    let expected = list_up_versions()?;
    let applied: Vec<String> =
        sqlx::query("SELECT version FROM schema_migrations ORDER BY version;")
            .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>("version"))
            .fetch_all(&pool)
            .await?;
    assert_eq!(applied.len(), expected.len(), "version count mismatch");
    assert_eq!(
        applied, expected,
        "schema_migrations must exactly match on-disk *.up.sql filenames"
    );

    let dir_mig = migrations_dir();
    for version in expected.iter().rev() {
        let down_path = dir_mig.join(version.replace(".up.sql", ".down.sql"));
        let sql = fs::read_to_string(&down_path)
            .with_context(|| format!("read {}", down_path.display()))?;
        let mut tx = pool.begin().await?;
        let has_sm: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations';",
        )
        .fetch_optional(&mut tx)
        .await?;
        if has_sm.is_some() {
            sqlx::query("DELETE FROM schema_migrations WHERE version = ?")
                .bind(version)
                .execute(&mut tx)
                .await?;
        }
        sqlx::query(&sql).execute(&mut tx).await?;
        tx.commit().await?;
    }

    let sm_exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations';",
    )
    .fetch_optional(&pool)
    .await?;
    if sm_exists.is_some() {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations;")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 0, "schema_migrations must be empty after rollback");
    }

    let tables = user_tables(&pool).await?;
    assert!(
        tables.is_empty(),
        "no user tables should remain, found: {tables:?}"
    );
    let indexes = user_indexes(&pool).await?;
    assert!(
        indexes.is_empty(),
        "no user indexes should remain, found: {indexes:?}"
    );
    assert_fk_and_integrity_ok(&pool).await?;

    let before_tables = tables;
    let before_indexes = indexes;

    for version in expected.iter().rev() {
        let down_path = dir_mig.join(version.replace(".up.sql", ".down.sql"));
        let sql = fs::read_to_string(&down_path)
            .with_context(|| format!("read {}", down_path.display()))?;
        let mut tx = pool.begin().await?;
        let has_sm: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations';",
        )
        .fetch_optional(&mut tx)
        .await?;
        if has_sm.is_some() {
            sqlx::query("DELETE FROM schema_migrations WHERE version = ?")
                .bind(version)
                .execute(&mut tx)
                .await?;
        }
        sqlx::query(&sql).execute(&mut tx).await?;
        tx.commit().await?;
    }

    let after_tables = user_tables(&pool).await?;
    let after_indexes = user_indexes(&pool).await?;
    assert_eq!(
        after_tables, before_tables,
        "second down pass changed tables"
    );
    assert_eq!(
        after_indexes, before_indexes,
        "second down pass changed indexes"
    );
    assert_fk_and_integrity_ok(&pool).await?;

    drop(pool);
    dir.close()?;
    Ok(())
}
