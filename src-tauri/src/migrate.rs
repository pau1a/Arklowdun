use anyhow::{anyhow, bail};
use include_dir::{include_dir, Dir};
use once_cell::sync::Lazy;
use regex::Regex;
use sqlx::sqlite::SqliteConnection;
use sqlx::{Executor, Row, SqlitePool};
use std::collections::HashSet;
use std::time::Instant;

use crate::time::now_ms;
use tracing::{debug, error, info, warn};

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
        if name.starts_with('_') {
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

#[allow(unused_assignments)]
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

async fn column_exists(
    conn: &mut SqliteConnection,
    table: &str,
    col: &str,
) -> anyhow::Result<bool> {
    let q = format!(
        "SELECT 1 FROM pragma_table_info('{}') WHERE name = ?",
        table.replace('\'', "''")
    );
    Ok(sqlx::query_scalar::<_, i64>(&q)
        .bind(col)
        .fetch_optional(&mut *conn)
        .await?
        .is_some())
}

async fn should_skip_stmt(conn: &mut SqliteConnection, stmt: &str) -> anyhow::Result<bool> {
    static ADD_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)^\s*ALTER\s+TABLE\s+([^\s]+)\s+ADD\s+COLUMN\s+([^\s(]+)").unwrap()
    });
    if let Some(c) = ADD_RE.captures(stmt) {
        let table = c.get(1).unwrap().as_str().trim_matches('"');
        let col = c.get(2).unwrap().as_str().trim_matches('"');
        return Ok(column_exists(conn, table, col).await?);
    }

    static RENAME_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)^\s*ALTER\s+TABLE\s+([^\s]+)\s+RENAME\s+COLUMN\s+([^\s]+)\s+TO\s+([^\s]+)")
            .unwrap()
    });
    if let Some(c) = RENAME_RE.captures(stmt) {
        let table = c.get(1).unwrap().as_str().trim_matches('"');
        let from = c.get(2).unwrap().as_str().trim_matches('"');
        return Ok(!column_exists(conn, table, from).await?);
    }

    static CREATE_INDEX_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)^\s*CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[^\s]+\s+ON\s+([^\s(]+)")
            .unwrap()
    });
    if let Some(c) = CREATE_INDEX_RE.captures(stmt) {
        let table = c.get(1).unwrap().as_str().trim_matches('"');
        let exists: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
                .bind(table)
                .fetch_optional(&mut *conn)
                .await?;
        if exists.is_none() {
            return Ok(true);
        }
    }

    Ok(false)
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

    // import legacy `migrations` table if present and no records exist yet
    if sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM schema_migrations")
        .fetch_one(pool)
        .await?
        == 0
    {
        if sqlx::query_scalar::<_, i64>(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations'",
        )
        .fetch_optional(pool)
        .await?
        .is_some()
        {
            let old = sqlx::query("SELECT id, applied_at FROM migrations")
                .fetch_all(pool)
                .await?;
            for row in old {
                let id: String = row.try_get("id")?;
                let applied_at: i64 = row.try_get("applied_at")?;
                let mapped = if id.ends_with(".sql") {
                    id.trim_end_matches(".sql").to_string() + ".up.sql"
                } else {
                    id.clone() + ".up.sql"
                };
                sqlx::query(
                    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                )
                .bind(mapped)
                .bind(applied_at)
                .execute(pool)
                .await?;
            }
        }
    }

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
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut *tx)
            .await?;
        let start = Instant::now();
        info!(target = "arklowdun", event = "migration_tx_begin", file = %filename);
        for stmt in split_statements(&cleaned) {
            if should_skip_stmt(tx.as_mut(), &stmt).await? {
                debug!(target = "arklowdun", event = "migration_stmt_skip", sql = %preview(&stmt));
                continue;
            }

            let mut stmt_to_run = stmt.clone();
            let upper_trim = stmt.trim_start().to_ascii_uppercase();
            if upper_trim.starts_with("INSERT INTO EVENTS_NEW")
                && upper_trim.contains("FROM EVENTS")
            {
                let has_datetime = column_exists(tx.as_mut(), "events", "datetime").await?;
                let has_start_at = column_exists(tx.as_mut(), "events", "start_at").await?;
                let has_starts_at = column_exists(tx.as_mut(), "events", "starts_at").await?;

                let src_col = if has_datetime {
                    "datetime"
                } else if has_start_at {
                    "start_at"
                } else if has_starts_at {
                    "starts_at"
                } else {
                    return Err(anyhow!(
                        "events table has none of [datetime,start_at,starts_at]"
                    ));
                };

                stmt_to_run = format!(
                    "INSERT INTO events_new \
             (id, title, datetime, reminder, household_id, created_at, updated_at, deleted_at) \
             SELECT id, title, {src} AS datetime, reminder, household_id, created_at, updated_at, deleted_at \
             FROM events",
                    src = src_col
                );
                debug!(
                    target = "arklowdun",
                    event = "migration_stmt_rewrite",
                    sql = %preview(&stmt_to_run)
                );
            }

            debug!(
                target = "arklowdun",
                event = "migration_stmt",
                sql = %preview(&stmt_to_run)
            );
            if let Err(e) = sqlx::query(stmt_to_run.as_str()).execute(&mut *tx).await {
                error!(target = "arklowdun", event = "migration_stmt_error", file = %filename, sql = %preview(&stmt_to_run), error = %e);
                warn!(target = "arklowdun", event = "migration_tx_rollback", file = %filename);
                return Err(e.into());
            }
        }
        let fk_rows = sqlx::query("PRAGMA foreign_key_check;")
            .fetch_all(&mut *tx)
            .await?;
        if !fk_rows.is_empty() {
            warn!(target = "arklowdun", event = "migration_tx_rollback", file = %filename);
            bail!("foreign key violations inside transaction for {}", filename);
        }
        debug!(
            target = "arklowdun",
            event = "migration_stmt",
            sql = "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
        );
        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
            .bind(&filename)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;
        if let Err(e) = tx.commit().await {
            warn!(target = "arklowdun", event = "migration_tx_rollback", file = %filename);
            return Err(e.into());
        }
        info!(
            target = "arklowdun",
            event = "migration_tx_commit",
            file = %filename,
            elapsed = ?start.elapsed()
        );
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

#[allow(dead_code)]
pub async fn revert_last_migration(pool: &SqlitePool) -> anyhow::Result<()> {
    pool.execute("PRAGMA foreign_keys=ON").await?;
    if let Some(row) =
        sqlx::query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
            .fetch_optional(pool)
            .await?
    {
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
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut *tx)
            .await?;
        let start = Instant::now();
        info!(target = "arklowdun", event = "migration_tx_begin", file = %version);
        for stmt in split_statements(&cleaned) {
            if should_skip_stmt(tx.as_mut(), &stmt).await? {
                debug!(target = "arklowdun", event = "migration_stmt_skip", sql = %preview(&stmt));
                continue;
            }
            debug!(target = "arklowdun", event = "migration_stmt", sql = %preview(&stmt));
            if let Err(e) = sqlx::query(stmt.as_str()).execute(&mut *tx).await {
                error!(target = "arklowdun", event = "migration_stmt_error", file = %version, sql = %preview(&stmt), error = %e);
                warn!(target = "arklowdun", event = "migration_tx_rollback", file = %version);
                return Err(e.into());
            }
        }
        let fk_rows = sqlx::query("PRAGMA foreign_key_check;")
            .fetch_all(&mut *tx)
            .await?;
        if !fk_rows.is_empty() {
            warn!(target = "arklowdun", event = "migration_tx_rollback", file = %version);
            bail!("foreign key violations inside transaction for {}", version);
        }
        debug!(
            target = "arklowdun",
            event = "migration_stmt",
            sql = "DELETE FROM schema_migrations WHERE version = ?"
        );
        sqlx::query("DELETE FROM schema_migrations WHERE version = ?")
            .bind(&version)
            .execute(&mut *tx)
            .await?;
        if let Err(e) = tx.commit().await {
            warn!(target = "arklowdun", event = "migration_tx_rollback", file = %version);
            return Err(e.into());
        }
        info!(target = "arklowdun", event = "migration_tx_commit", file = %version, elapsed = ?start.elapsed());
    }
    Ok(())
}
