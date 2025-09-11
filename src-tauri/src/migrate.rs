use regex::Regex;
use sha2::{Digest, Sha256};
use sqlx::{Executor, Row, SqlitePool};
use std::collections::HashMap;

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
        "202509011559_initial.sql",
        include_str!("../../migrations/202509011559_initial.sql"),
    ),
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
    (
        "202509041200_vehicles_rework.sql",
        include_str!("../../migrations/202509041200_vehicles_rework.sql"),
    ),
    (
        "202509081200_idx_bills_household_due.sql",
        include_str!("../../migrations/202509081200_idx_bills_household_due.sql"),
    ),
    (
        "202509091200_events_add_rrule_exdates.sql",
        include_str!("../../migrations/202509091200_events_add_rrule_exdates.sql"),
    ),
    (
        "202509101200_search_indexes.sql",
        include_str!("../../migrations/202509101200_search_indexes.sql"),
    ),
    (
        "202509111200_files_index.sql",
        include_str!("../../migrations/202509111200_files_index.sql"),
    ),
    // removed: legacy events backfill is handled in code now
];

pub async fn apply_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\
           version   TEXT PRIMARY KEY,\
           applied_at INTEGER NOT NULL,\
           checksum TEXT NOT NULL\
         )",
    )
    .await?;

    // Backfill checksum column if the table predates it
    let has_checksum: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM pragma_table_info('schema_migrations') WHERE name='checksum'",
    )
    .fetch_optional(pool)
    .await?;
    if has_checksum.is_none() {
        sqlx::query("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT")
            .execute(pool)
            .await?;
        for (filename, raw_sql) in MIGRATIONS {
            let cleaned = raw_sql
                .lines()
                .filter(|line| {
                    let t = line.trim_start();
                    !(t.is_empty() || t.starts_with("--"))
                })
                .collect::<Vec<_>>()
                .join("\n");
            let checksum = format!("{:x}", Sha256::digest(cleaned.as_bytes()));
            sqlx::query("UPDATE schema_migrations SET checksum = ? WHERE version = ?")
                .bind(&checksum)
                .bind(*filename)
                .execute(pool)
                .await?;
        }
    }

    let rows = sqlx::query("SELECT version, checksum FROM schema_migrations")
        .fetch_all(pool)
        .await?;
    let mut applied: HashMap<String, String> = HashMap::new();
    for r in rows {
        if let (Ok(v), Ok(c)) = (
            r.try_get::<String, _>("version"),
            r.try_get::<String, _>("checksum"),
        ) {
            applied.insert(v, c);
        }
    }
    let add_col_re = Regex::new(r"(?i)^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)").unwrap();

    for (filename, raw_sql) in MIGRATIONS {
        let cleaned = raw_sql
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                !(t.is_empty() || t.starts_with("--"))
            })
            .collect::<Vec<_>>()
            .join("\n");
        let checksum = format!("{:x}", Sha256::digest(cleaned.as_bytes()));

        if let Some(stored) = applied.get(*filename) {
            if stored != &checksum {
                anyhow::bail!("migration {} edited after application", filename);
            }
            info!(target = "arklowdun", event = "migration_skip_file", file = %filename);
            continue;
        }

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
            if let Some(caps) = add_col_re.captures(s) {
                let table = caps.get(1).unwrap().as_str();
                let col = caps.get(2).unwrap().as_str();
                let exists: Option<i64> = sqlx::query_scalar(&format!(
                    "SELECT 1 FROM pragma_table_info('{}') WHERE name='{}'",
                    table, col
                ))
                .fetch_optional(&mut *tx)
                .await?;
                if exists.is_some() {
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

        sqlx::query(
            "INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)",
        )
        .bind(*filename)
        .bind(now_ms())
        .bind(&checksum)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        info!(target = "arklowdun", event = "migration_file_applied", file = %filename);
    }

    // Backfill next_* from legacy columns if present
    if sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM pragma_table_info('vehicles') WHERE name='mot_date'",
    )
    .fetch_optional(pool)
    .await?
    .is_some()
    {
        let sql = "UPDATE vehicles SET next_mot_due = mot_date WHERE next_mot_due IS NULL AND mot_date IS NOT NULL";
        info!(target = "arklowdun", event = "migration_stmt", sql = %preview(sql));
        sqlx::query(sql).execute(pool).await?;
    }
    if sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM pragma_table_info('vehicles') WHERE name='service_date'",
    )
    .fetch_optional(pool)
    .await?
    .is_some()
    {
        let sql = "UPDATE vehicles SET next_service_due = service_date WHERE next_service_due IS NULL AND service_date IS NOT NULL";
        info!(target = "arklowdun", event = "migration_stmt", sql = %preview(sql));
        sqlx::query(sql).execute(pool).await?;
    }

    // Guarded schema compatibility shims (idempotent)
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_household_start_end ON events(household_id, start_at, end_at)",
    )
    .execute(pool)
    .await?;

    Ok(())
}
