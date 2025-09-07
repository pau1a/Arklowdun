use sqlx::{Executor, Row, SqlitePool};
use std::collections::HashSet;

use crate::time::now_ms;
use tracing::{error, info};

fn preview(sql: &str) -> String {
    let one_line = sql.replace(['\n', '\t'], " ");
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
        "202509021500_events_start_idx.sql",
        include_str!("../../migrations/202509021500_events_start_idx.sql"),
    ),
    (
        "202509031550_household_add_tz.sql",
        include_str!("../../migrations/202509031550_household_add_tz.sql"),
    ),
    (
        "202509031600_events_add_tz_and_utc.sql",
        include_str!("../../migrations/202509031600_events_add_tz_and_utc.sql"),
    ),
    (
        "202509031700_events_start_at_utc_index.sql",
        include_str!("../../migrations/202509031700_events_start_at_utc_index.sql"),
    ),
    // removed: legacy events backfill is handled in code now
];

pub async fn apply_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\
           version   TEXT PRIMARY KEY,\
           applied_at INTEGER NOT NULL\
         )",
    )
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
            if upper.starts_with("ALTER TABLE EVENTS RENAME COLUMN STARTS_AT TO START_AT") {
                let exists: Option<i64> = sqlx::query_scalar(
                    "SELECT 1 FROM pragma_table_info('events') WHERE name = 'starts_at'",
                )
                .fetch_optional(&mut *tx)
                .await?;
                if exists.is_none() {
                    info!(target = "arklowdun", event = "migration_stmt_skip", file = %filename, sql = %preview(s));
                    continue;
                }
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

    // Guarded schema compatibility shims (idempotent)
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_household_start_end ON events(household_id, start_at, end_at)",
    )
    .execute(pool)
    .await?;

    Ok(())
}

