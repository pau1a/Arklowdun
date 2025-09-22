#![allow(clippy::unwrap_used, clippy::expect_used)]

use anyhow::{anyhow, Context, Result};
use arklowdun_lib::migration_guard::{self, GuardError};
use clap::{Parser, Subcommand};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
    ConnectOptions, Row, SqliteConnection, SqlitePool,
};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Parser)]
#[command(name = "migrate", about = "Arklowdun migration helper")]
struct Cli {
    /// Optional explicit DB path
    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    /// Print SQL without executing for up/down
    #[arg(long)]
    dry_run: bool,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List migrations and show applied/pending
    #[command(about, long_about = None)]
    List,
    /// Show current migration status
    #[command(about, long_about = None)]
    Status,
    /// Apply pending migrations (optionally up to a target version)
    #[command(about, long_about = None)]
    Up {
        /// Target version (NNNN) to stop at (inclusive)
        #[arg(long, value_name = "NNNN")]
        to: Option<String>,
    },
    /// DEV-ONLY: Roll back migrations (one step or down to target)
    #[command(about, long_about = None)]
    Down {
        /// Target version (NNNN) to roll back to (stop when current==to)
        #[arg(long, value_name = "NNNN")]
        to: Option<String>,
    },
    /// Check UTC backfill guard status without running migrations
    #[command(about, long_about = None)]
    Check,
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = tracing_log::LogTracer::init();
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("TAURI_ARKLOWDUN_LOG")
                .unwrap_or_else(|_| "arklowdun=info,sqlx=warn".into()),
        )
        .json()
        .with_target(true)
        .with_timer(tracing_subscriber::fmt::time::UtcTime::rfc_3339())
        .try_init();

    let cli = Cli::parse();
    let db_path = cli.db.unwrap_or(default_db_path()?);

    match cli.cmd {
        Cmd::List => list(&db_path).await,
        Cmd::Status => status(&db_path).await,
        Cmd::Up { to } => up(&db_path, cli.dry_run, to.as_deref()).await,
        Cmd::Down { to } => down(&db_path, cli.dry_run, to.as_deref()).await,
        Cmd::Check => guard_check(&db_path).await,
    }
}

fn default_db_path() -> Result<PathBuf> {
    let base = dirs::data_dir().unwrap_or(std::env::current_dir()?);
    Ok(base.join("com.paula.arklowdun").join("arklowdun.sqlite3"))
}

async fn open_pool(db: &Path, create: bool) -> Result<SqlitePool> {
    if create {
        if let Some(parent) = db.parent() {
            let _ = fs::create_dir_all(parent);
        }
    }
    let mut opts = SqliteConnectOptions::new().filename(db);
    if create {
        opts = opts.create_if_missing(true);
    } else {
        opts = opts.create_if_missing(false);
    }
    let opts = opts
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .log_statements(log::LevelFilter::Off);
    let pool = SqlitePool::connect_with(opts).await?;
    sqlx::query("PRAGMA busy_timeout = 5000;")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("PRAGMA wal_autocheckpoint = 1000;")
        .execute(&pool)
        .await
        .ok();
    Ok(pool)
}

fn migrations_dir() -> Result<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    Ok(root.join("migrations"))
}

fn discover_migrations() -> Result<Vec<(String, PathBuf, Option<PathBuf>)>> {
    let dir = migrations_dir()?;
    let mut ups = vec![];
    for entry in fs::read_dir(&dir).with_context(|| format!("read {:?}", dir))? {
        let p = entry?.path();
        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".up.sql") {
                let stem = name.trim_end_matches(".up.sql").to_string();
                let down = dir.join(format!("{}.down.sql", stem));
                ups.push((stem, p.clone(), down.exists().then_some(down)));
            }
        }
    }
    ups.sort_by_key(|(stem, _, _)| stem.clone());
    Ok(ups)
}

async fn applied_set(pool: &SqlitePool) -> Result<HashSet<String>> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Ok(HashSet::new());
    }
    let rows = sqlx::query("SELECT version FROM schema_migrations")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| r.try_get::<String, _>("version").ok())
        .collect())
}

async fn list(db: &Path) -> Result<()> {
    let applied = if db.exists() {
        let pool = open_pool(db, false).await?;
        applied_set(&pool).await?
    } else {
        HashSet::new()
    };
    println!("DB: {}", db.display());
    for (stem, _up, _down) in discover_migrations()? {
        let fname = format!("{}.up.sql", stem);
        let state = if applied.contains(&fname) {
            "applied"
        } else {
            "pending"
        };
        println!("{:<32}  {}", stem, state);
    }
    Ok(())
}

async fn status(db: &Path) -> Result<()> {
    let all = discover_migrations()?;
    let applied = if db.exists() {
        let pool = open_pool(db, false).await?;
        applied_set(&pool).await?
    } else {
        HashSet::new()
    };
    let applied_count = all
        .iter()
        .filter(|(stem, _, _)| applied.contains(&format!("{}.up.sql", stem)))
        .count();
    let head = all
        .iter()
        .rev()
        .find(|(stem, _, _)| applied.contains(&format!("{}.up.sql", stem)))
        .map(|(s, _, _)| s.as_str())
        .unwrap_or("<none>");
    println!("DB: {}", db.display());
    println!("Applied: {}/{}", applied_count, all.len());
    println!("Head: {}", head);
    Ok(())
}

async fn up(db: &Path, dry: bool, to: Option<&str>) -> Result<()> {
    let pool = open_pool(db, true).await?;
    let all = discover_migrations()?;
    let applied = applied_set(&pool).await?;

    let mut plan: Vec<(String, String)> = vec![];
    for (stem, up_path, _) in &all {
        let fname = format!("{}.up.sql", stem);
        if applied.contains(&fname) {
            continue;
        }
        plan.push((fname.clone(), fs::read_to_string(up_path)?));
        if let Some(target) = to {
            if stem.split('_').next() == Some(target) {
                break;
            }
        }
    }

    if plan.is_empty() {
        println!("Nothing to apply.");
        return Ok(());
    }

    println!("Plan (up):");
    for (f, _) in &plan {
        println!("  {}", f);
    }
    if dry {
        return Ok(());
    }

    for (filename, sql) in plan {
        log::info!("migration start {}", filename);
        let mut tx = pool.begin().await?;
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut *tx)
            .await?;
        if filename == "0023_events_drop_legacy_time.up.sql" {
            ensure_events_utc_time_columns_clean(tx.as_mut()).await?;
        }
        let start = Instant::now();
        for stmt in split_stmts(&sql) {
            sqlx::query(&stmt)
                .execute(&mut *tx)
                .await
                .with_context(|| format!("{}: {}", filename, stmt_preview(&stmt)))?;
        }
        if !sqlx::query("PRAGMA foreign_key_check;")
            .fetch_all(&mut *tx)
            .await?
            .is_empty()
        {
            anyhow::bail!("foreign key violations in {}", filename);
        }
        sqlx::query(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
        )
        .bind(&filename)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        if filename == "0023_events_drop_legacy_time.up.sql" {
            let rows: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check;")
                .fetch_all(&pool)
                .await?;
            let status = if rows.is_empty() {
                "no_result".to_string()
            } else {
                rows.join("; ")
            };
            if status == "ok" {
                tracing::info!(
                    target: "arklowdun",
                    event = "sqlite_integrity_check",
                    status = "ok"
                );
            } else {
                tracing::warn!(
                    target: "arklowdun",
                    event = "sqlite_integrity_check",
                    status = %status
                );
            }
            migration_guard::ensure_events_indexes(&pool).await?;
        }
        log::info!("migration success {} in {:?}", filename, start.elapsed());
        if let Some(target) = to {
            if filename.split('_').next() == Some(target) {
                break;
            }
        }
    }
    Ok(())
}

async fn down(db: &Path, dry: bool, to: Option<&str>) -> Result<()> {
    if std::env::var("ARKLOWDUN_ALLOW_DOWN").ok().as_deref() != Some("1")
        || std::env::var("CI").ok() == Some("true".into())
    {
        return Err(anyhow!(
            "Down migrations are disabled. Set ARKLOWDUN_ALLOW_DOWN=1 (not in CI) to proceed.",
        ));
    }

    let pool = open_pool(db, true).await?;
    let all = discover_migrations()?;
    let applied = applied_set(&pool).await?;

    let mut applied_in_order: Vec<(String, Option<PathBuf>)> = all
        .into_iter()
        .filter(|(stem, _up, _down)| applied.contains(&format!("{}.up.sql", stem)))
        .map(|(stem, _up, down)| (stem, down))
        .collect();

    if applied_in_order.is_empty() {
        println!("Nothing to roll back.");
        return Ok(());
    }

    let mut plan: Vec<(String, String)> = vec![];
    while let Some((stem, down_path)) = applied_in_order.pop() {
        let fname = format!("{}.down.sql", stem);
        let path = down_path.ok_or_else(|| anyhow!("no down file for {}", stem))?;
        let sql = fs::read_to_string(&path)?;
        plan.push((fname.clone(), sql));
        if let Some(target) = to {
            if stem.split('_').next() == Some(target) {
                break;
            }
        } else {
            break;
        }
    }

    println!("Plan (down):");
    for (f, _) in &plan {
        println!("  {}", f);
    }
    if dry {
        return Ok(());
    }

    for (filename, sql) in plan {
        log::info!("rollback start {}", filename);
        let mut tx = pool.begin().await?;
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM schema_migrations WHERE version=?1")
            .bind(filename.replace(".down.sql", ".up.sql"))
            .execute(&mut *tx)
            .await
            .ok();
        for stmt in split_stmts(&sql) {
            sqlx::query(&stmt)
                .execute(&mut *tx)
                .await
                .with_context(|| format!("{}: {}", filename, stmt_preview(&stmt)))?;
        }
        tx.commit().await?;
        log::info!("rollback success {}", filename);
    }
    Ok(())
}

async fn guard_check(db: &Path) -> Result<()> {
    if !db.exists() {
        anyhow::bail!("database not found: {}", db.display());
    }
    let pool = open_pool(db, false).await?;
    println!("Database: {}", db.display());
    match migration_guard::enforce_events_legacy_columns_removed(&pool).await {
        Ok(status) => {
            if status.is_clear() {
                println!("Legacy events columns: OK (start_at/end_at dropped).");
            }
        }
        Err(err) => {
            if let Some(guard) = err.downcast_ref::<GuardError>() {
                println!("Legacy events columns: {}", guard.operator_message());
            } else {
                println!("Legacy events columns: {}", err);
            }
            return Err(err);
        }
    }

    migration_guard::ensure_events_indexes(&pool).await?;
    let status = migration_guard::check_events_backfill(&pool).await?;

    if status.total_missing == 0 {
        println!("All events have UTC timestamps. Backfill guard OK.");
        return Ok(());
    }

    println!("Households with events missing UTC fields:");
    for hh in &status.households {
        println!(
            "  {id}: start_at_utc missing {start}, end_at_utc missing {end}, total {total}",
            id = hh.household_id,
            start = hh.missing_start_at_utc,
            end = hh.missing_end_at_utc,
            total = hh.missing_total
        );
    }

    let message = migration_guard::format_guard_failure(&status);
    Err(anyhow!(message))
}

fn split_stmts(sql: &str) -> Vec<String> {
    let cleaned = sql
        .lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");
    cleaned
        .split(';')
        .map(str::trim)
        .filter(|s| {
            !s.is_empty()
                && !s.eq_ignore_ascii_case("BEGIN TRANSACTION")
                && !s.eq_ignore_ascii_case("COMMIT")
        })
        .map(|s| s.to_string())
        .collect()
}

fn stmt_preview(s: &str) -> String {
    let s = s.replace('\n', " ");
    if s.len() > 180 {
        format!("{}…", &s[..180])
    } else {
        s
    }
}

async fn ensure_events_utc_time_columns_clean(conn: &mut SqliteConnection) -> Result<()> {
    let missing_start_utc: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE start_at_utc IS NULL")
            .fetch_one(&mut *conn)
            .await
            .context("precheck: count NULL start_at_utc values")?;

    let missing_end_utc: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE end_at IS NOT NULL AND end_at_utc IS NULL",
    )
    .fetch_one(&mut *conn)
    .await
    .context("precheck: count legacy end_at rows missing end_at_utc")?;

    if missing_start_utc > 0 || missing_end_utc > 0 {
        anyhow::bail!(format!(
            "Migration 0023 blocked: {missing_start_utc} rows have NULL start_at_utc and {missing_end_utc} rows still rely on legacy end_at without end_at_utc. Run the timezone backfill before dropping start_at/end_at."
        ));
    }

    Ok(())
}
