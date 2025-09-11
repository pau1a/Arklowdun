use anyhow::bail;
use sqlx::{Executor, Row, SqlitePool};
use std::collections::HashSet;
use std::time::Instant;
use include_dir::{include_dir, Dir};

use crate::time::now_ms;
use tracing::{error, info};

static MIGRATIONS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../migrations");

fn preview(sql: &str) -> String {
    let one_line = sql.replace(['\n', '\t'], " ");
    let trimmed = one_line.trim();
    if trimmed.len() > 160 {
        format!("{}…", &trimmed[..160])
    } else {
        trimmed.to_string()
    }
}

fn load_migrations() -> anyhow::Result<Vec<(String, String, String)>> {
    let mut entries = Vec::new();
    for file in MIGRATIONS_DIR.files() {
        let path = file.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.ends_with(".up.sql") {
            continue;
        }
        let stem = name.trim_end_matches(".up.sql");
        let down_name = format!("{}.down.sql", stem);
        let down_file = MIGRATIONS_DIR
            .get_file(&down_name)
            .ok_or_else(|| anyhow::anyhow!("missing down migration for {}", stem))?;
        let up_sql = file
            .contents_utf8()
            .ok_or_else(|| anyhow::anyhow!("invalid utf8"))?
            .to_string();
        let down_sql = down_file
            .contents_utf8()
            .ok_or_else(|| anyhow::anyhow!("invalid utf8"))?
            .to_string();
        entries.push((name.to_string(), up_sql, down_sql));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(entries)
}

fn split_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_trigger = false;
    let mut word = String::new();
    let mut last_word = String::new();
    let mut end_seen = false;

    for c in sql.chars() {
        if !in_single && !in_double {
            if c.is_ascii_alphabetic() || c == '_' {
                word.push(c.to_ascii_uppercase());
            } else {
                if !word.is_empty() {
                    if !in_trigger && word == "TRIGGER" && last_word == "CREATE" {
                        in_trigger = true;
                    } else if in_trigger && word == "END" {
                        end_seen = true;
                    }
                    last_word = word.clone();
                    word.clear();
                }

                if end_seen && c == ';' {
                    current.push(c);
                    let stmt = current.trim();
                    if !stmt.is_empty() {
                        statements.push(stmt.to_string());
                    }
                    current.clear();
                    end_seen = false;
                    in_trigger = false;
                    continue;
                }
            }
        }

        match c {
            '\'' if !in_double => {
                in_single = !in_single;
                current.push(c);
            }
            '"' if !in_single => {
                in_double = !in_double;
                current.push(c);
            }
            ';' if !in_single && !in_double && !in_trigger => {
                let stmt = current.trim();
                if !stmt.is_empty() {
                    statements.push(stmt.to_string());
                }
                current.clear();
            }
            _ => current.push(c),
        }
    }
    if !word.is_empty() && in_trigger && word == "END" {
        end_seen = true;
    }
    let stmt = current.trim();
    if !stmt.is_empty() {
        statements.push(stmt.to_string());
    }
    statements
}

pub async fn apply_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute("PRAGMA foreign_keys=ON").await?;
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

    for (filename, raw_sql, _) in load_migrations()? {
        if applied.contains(&filename) {
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
        tx.execute("PRAGMA foreign_keys=ON").await?;
        let start = Instant::now();
        info!(target = "arklowdun", event = "migration_begin", file = %filename);
        for stmt in split_statements(&cleaned) {
            info!(target = "arklowdun", event = "migration_stmt", sql = %preview(&stmt));
            if let Err(e) = tx.execute(stmt.as_str()).await {
                error!(target = "arklowdun", event = "migration_stmt_error", file = %filename, error = %e);
                return Err(e.into());
            }
        }
        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
            .bind(&filename)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        let fk_rows = sqlx::query("PRAGMA foreign_key_check;")
            .fetch_all(pool)
            .await?;
        if !fk_rows.is_empty() {
            bail!("foreign key violations after {}", filename);
        }
        info!(target = "arklowdun", event = "migration_end", file = %filename, elapsed = ?start.elapsed());
    }

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

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_household_start_end ON events(household_id, start_at, end_at)",
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn revert_last_migration(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute("PRAGMA foreign_keys=ON").await?;
    if let Some(row) = sqlx::query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
        .fetch_optional(pool)
        .await? {
        let version: String = row.try_get("version")?;
        let migrations = load_migrations()?;
        let (_, _, down_sql) = migrations
            .into_iter()
            .find(|(v, _, _)| *v == version)
            .ok_or_else(|| anyhow::anyhow!("missing migration file for {}", version))?;
        let cleaned = down_sql
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                !(t.is_empty() || t.starts_with("--"))
            })
            .collect::<Vec<_>>()
            .join("\n");
        let mut tx = pool.begin().await?;
        tx.execute("PRAGMA foreign_keys=ON").await?;
        let start = Instant::now();
        info!(target = "arklowdun", event = "migration_begin", file = %version);
        for stmt in split_statements(&cleaned) {
            info!(target = "arklowdun", event = "migration_stmt", sql = %preview(&stmt));
            tx.execute(stmt.as_str()).await?;
        }
        sqlx::query("DELETE FROM schema_migrations WHERE version = ?")
            .bind(&version)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        info!(target = "arklowdun", event = "migration_end", file = %version, elapsed = ?start.elapsed());
    }
    Ok(())
}
