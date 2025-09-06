use sqlx::{Executor, Row, SqlitePool};
use std::collections::HashSet;

use crate::time::now_ms;
use tracing::{error, info};

async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> sqlx::Result<bool> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?",
    )
    .bind(table)
    .bind(column)
    .fetch_one(pool)
    .await?;
    Ok(count > 0)
}

async fn ensure_column(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    col_def_sql: &str,
) -> sqlx::Result<()> {
    if column_exists(pool, table, column).await? {
        info!(target = "arklowdun", event = "migration_skip_column", table = %table, column = %column);
        return Ok(());
    }
    let sql = format!("ALTER TABLE {table} ADD COLUMN {col_def_sql}");
    info!(target = "arklowdun", event = "migration_add_column", table = %table, column = %column, sql = %sql);
    sqlx::query(&sql).execute(pool).await?;
    Ok(())
}

fn preview(sql: &str) -> String {
    let one_line = sql.replace('\n', " ").replace('\t', " ");
    let trimmed = one_line.trim();
    if trimmed.len() > 160 {
        format!("{}…", &trimmed[..160])
    } else {
        trimmed.to_string()
    }
}

static MIGRATIONS: &[(&str, &str)] = &[
    (
        "202509012006_household.sql",
        include_str!("../../migrations/202509012006_household.sql"),
    ),
    (
        "202509012007_domain_tables.sql",
        include_str!("../../migrations/202509012007_domain_tables.sql"),
    ),
    (
        "202509020800_add_deleted_at.sql",
        include_str!("../../migrations/202509020800_add_deleted_at.sql"),
    ),
    (
        "202509020900_add_positions.sql",
        include_str!("../../migrations/202509020900_add_positions.sql"),
    ),
    (
        "202509021100_add_file_paths.sql",
        include_str!("../../migrations/202509021100_add_file_paths.sql"),
    ),
    (
        "202509021200_import_id_map.sql",
        include_str!("../../migrations/202509021200_import_id_map.sql"),
    ),
    (
        "202509021300_explicit_fk_actions.sql",
        include_str!("../../migrations/202509021300_explicit_fk_actions.sql"),
    ),
    (
        "202509021301_fk_integrity_check.sql",
        include_str!("../../migrations/202509021301_fk_integrity_check.sql"),
    ),
    (
        "202509021400_soft_delete_notes_shopping.sql",
        include_str!("../../migrations/202509021400_soft_delete_notes_shopping.sql"),
    ),
    (
        "202509021410_notes_z_index.sql",
        include_str!("../../migrations/202509021410_notes_z_index.sql"),
    ),
    (
        "202509061700_events_time_columns.sql",
        include_str!("../../migrations/202509061700_events_time_columns.sql"),
    ),
];

pub async fn apply_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\
           version   TEXT PRIMARY KEY,\
           applied_at INTEGER NOT NULL\
         )",
    )
    .await?;

    // Guarded schema compatibility shims (idempotent)
    ensure_column(pool, "events", "start_at", "start_at INTEGER").await?;
    ensure_column(pool, "events", "end_at", "end_at   INTEGER").await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_household_start_end ON events(household_id, start_at, end_at)",
    )
    .execute(pool)
    .await?;

    let rows = sqlx::query("SELECT version FROM schema_migrations")
        .fetch_all(pool)
        .await?;
    let applied: HashSet<String> = rows
        .into_iter()
        .filter_map(|r| r.try_get("version").ok())
        .collect();

    for (filename, raw_sql) in MIGRATIONS {
        if applied.contains(*filename) {
            info!(target = "arklowdun", event = "migration_skip_file", file = %filename);
            continue;
        }

        let cleaned = raw_sql
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                !(t.is_empty() || t.starts_with("--"))
            })
            .collect::<Vec<_>>()
            .join("\n");

        let mut tx = pool.begin().await?;
        for stmt in cleaned.split(';') {
            let s = stmt.trim();
            if s.is_empty() {
                continue;
            }
            let upper = s.to_ascii_uppercase();
            if upper == "BEGIN" || upper == "COMMIT" {
                continue;
            }
            info!(target = "arklowdun", event = "migration_stmt", file = %filename, sql = %preview(s));
            if let Err(e) = sqlx::query(s).execute(&mut *tx).await {
                error!(target = "arklowdun", event = "migration_stmt_error", file = %filename, sql = %preview(s), error = %e);
                return Err(e.into());
            }
        }

        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
            .bind(*filename)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        info!(target = "arklowdun", event = "migration_file_applied", file = %filename);
    }

    Ok(())
}

