use sqlx::{Executor, Row, SqlitePool};
use std::collections::HashSet;

use crate::time::now_ms;

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
];

pub async fn apply_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
               version TEXT PRIMARY KEY,
               applied_at INTEGER NOT NULL
             )",
    )
    .await?;

    let rows = sqlx::query("SELECT version FROM schema_migrations")
        .fetch_all(&pool)
        .await?;
    let applied: HashSet<String> = rows
        .into_iter()
        .filter_map(|r| r.try_get("version").ok())
        .collect();

    for (filename, raw_sql) in MIGRATIONS {
        if applied.contains(*filename) {
            continue;
        }

        // Remove comment lines and blanks before splitting statements.
        let cleaned = raw_sql
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                !(t.is_empty() || t.starts_with("--"))
            })
            .collect::<Vec<_>>()
            .join("\n");

        // Execute each file within a transaction and ignore file-level BEGIN/COMMIT.
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
            sqlx::query(s).execute(&mut *tx).await?;
        }

        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
            .bind(*filename)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
    }

    Ok(())
}
