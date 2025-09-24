// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::ConnectOptions;
use sqlx::SqlitePool;

use arklowdun_lib::db::{
    backup,
    health::{DbHealthReport, DbHealthStatus},
    repair::{
        self, DbRepairEvent, DbRepairOptions, DbRepairStep, DbRepairStepState, DbRepairSummary,
    },
};
use arklowdun_lib::ipc::guard::{DB_UNHEALTHY_CLI_HINT, DB_UNHEALTHY_CODE, DB_UNHEALTHY_EXIT_CODE};
use arklowdun_lib::AppError;

#[derive(Debug, Parser)]
#[command(name = "arklowdun", about = "Arklowdun desktop application", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Database maintenance and inspection commands.
    #[command(subcommand)]
    Db(DbCommand),
}

#[derive(Debug, Subcommand)]
enum DbCommand {
    /// Run the SQLite health checks and report their status.
    Status {
        /// Emit the raw JSON health report instead of the table view.
        #[arg(long)]
        json: bool,
    },
    /// Run VACUUM to compact the database when it is healthy.
    Vacuum,
    /// Create a consistent snapshot of the database with manifest metadata.
    Backup {
        /// Emit a machine-readable JSON object with the backup entry details.
        #[arg(long)]
        json: bool,
    },
    /// Attempt to repair a corrupted database by rebuilding and swapping files.
    Repair,
}

fn main() {
    arklowdun_lib::init_logging();

    let cli = Cli::parse();
    if let Some(command) = cli.command {
        match handle_cli(command) {
            Ok(code) => process::exit(code),
            Err(err) => {
                eprintln!("Error: {err:#}");
                process::exit(1);
            }
        }
    }

    tracing::debug!(target: "arklowdun", "app booted");
    arklowdun_lib::run()
}

fn handle_cli(command: Commands) -> Result<i32> {
    match command {
        Commands::Db(db) => handle_db_command(db),
    }
}

fn handle_db_command(command: DbCommand) -> Result<i32> {
    match command {
        DbCommand::Status { json } => {
            let db_path = default_db_path().context("determine database path")?;
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent).with_context(|| {
                    format!("create database parent directory {}", parent.display())
                })?;
            }

            let report = tauri::async_runtime::block_on(async {
                let pool = open_health_pool(&db_path).await?;
                let report = arklowdun_lib::db::health::run_health_checks(&pool, &db_path)
                    .await
                    .context("run database health checks")?;
                pool.close().await;
                Result::<DbHealthReport>::Ok(report)
            })?;

            if json {
                print_report_json(&report)?;
            } else {
                print_report_table(&report);
            }

            Ok(match report.status {
                DbHealthStatus::Ok => 0,
                DbHealthStatus::Error => 1,
            })
        }
        DbCommand::Vacuum => handle_db_vacuum(),
        DbCommand::Backup { json } => handle_db_backup(json),
        DbCommand::Repair => handle_db_repair(),
    }
}

fn guard_cli_db_mutation(db_path: &Path) -> Result<Result<SqlitePool, i32>> {
    tauri::async_runtime::block_on(async {
        let pool = open_health_pool(db_path).await?;
        let report = arklowdun_lib::db::health::run_health_checks(&pool, db_path)
            .await
            .context("run database health checks")?;
        if !matches!(report.status, DbHealthStatus::Ok) {
            eprintln!("Error: {}. {}", DB_UNHEALTHY_CODE, DB_UNHEALTHY_CLI_HINT);
            pool.close().await;
            return Ok(Err(DB_UNHEALTHY_EXIT_CODE));
        }
        Ok(Ok(pool))
    })
}

fn handle_db_vacuum() -> Result<i32> {
    let db_path = default_db_path().context("determine database path")?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create database parent directory {}", parent.display()))?;
    }

    match guard_cli_db_mutation(&db_path)? {
        Ok(pool) => {
            tauri::async_runtime::block_on(async move {
                let result = sqlx::query("VACUUM;")
                    .execute(&pool)
                    .await
                    .context("vacuum database");
                pool.close().await;
                result.map(|_| ())
            })?;
            println!("Database vacuum completed.");
            Ok(0)
        }
        Err(code) => Ok(code),
    }
}

fn handle_db_backup(emit_json: bool) -> Result<i32> {
    let db_path = default_db_path().context("determine database path")?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create database parent directory {}", parent.display()))?;
    }

    match guard_cli_db_mutation(&db_path)? {
        Ok(pool) => {
            let entry = tauri::async_runtime::block_on(async {
                let result = backup::create_backup(&pool, &db_path)
                    .await
                    .context("create database backup");
                pool.close().await;
                result
            })?;
            if emit_json {
                let path = entry.sqlite_path.clone();
                let payload = json!({
                    "entry": entry,
                    "path": path,
                });
                let serialized = serde_json::to_string_pretty(&payload)
                    .context("serialize backup entry payload")?;
                println!("{serialized}");
            } else {
                let manifest_json = serde_json::to_string_pretty(&entry.manifest)
                    .context("serialize backup manifest")?;
                println!("{manifest_json}");
                println!("Backup stored at {}", entry.sqlite_path);
            }
            Ok(0)
        }
        Err(code) => Ok(code),
    }
}

fn handle_db_repair() -> Result<i32> {
    let db_path = default_db_path().context("determine database path")?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create database parent directory {}", parent.display()))?;
    }

    let pool = tauri::async_runtime::block_on(open_health_pool(&db_path))?;

    let printer: Arc<dyn Fn(DbRepairEvent) + Send + Sync> = Arc::new(|event| match event {
        DbRepairEvent::Step {
            step,
            status,
            message,
        } => {
            let label = cli_step_label(&step);
            let status_label = cli_status_label(&status);
            if let Some(msg) = message {
                println!("{label:<12} {status_label:<9} {msg}");
            } else {
                println!("{label:<12} {status_label:<9}");
            }
        }
    });

    let options = {
        let pool = pool.clone();
        let db_path = db_path.clone();
        DbRepairOptions {
            before_swap: Some(Arc::new(move || {
                let pool = pool.clone();
                Box::pin(async move {
                    pool.close().await;
                    Ok(())
                })
            })),
            after_swap: Some(Arc::new(move || {
                let db_path = db_path.clone();
                Box::pin(async move {
                    let pool = open_health_pool(&db_path).await.map_err(|err| {
                        AppError::from(err).with_context("operation", "reopen_pool_after_swap")
                    })?;
                    let report = arklowdun_lib::db::health::run_health_checks(&pool, &db_path)
                        .await
                        .map_err(|err| err.with_context("operation", "repair_post_swap_health"))?;
                    pool.close().await;
                    Ok(Some(report))
                })
            })),
        }
    };

    let summary: DbRepairSummary = tauri::async_runtime::block_on(async {
        let result =
            repair::run_guided_repair(&pool, &db_path, Some(printer.clone()), options).await;
        pool.close().await;
        result
    })?;

    println!();
    if summary.success {
        println!("Repair complete. Your data was verified and restored safely.");
        if let Some(path) = &summary.backup_directory {
            println!("Pre-repair backup: {path}");
        }
        if let Some(path) = &summary.archived_db_path {
            println!("Original database archived as: {path}");
        }
        if summary.duration_ms > 0 {
            println!(
                "Elapsed: {:.2} seconds",
                summary.duration_ms as f64 / 1000.0
            );
        }
        Ok(0)
    } else {
        println!("Repair failed. Your database remains in read-only mode.");
        if let Some(error) = &summary.error {
            println!("Reason: {} ({})", error.message(), error.code());
        }
        if let Some(path) = &summary.backup_directory {
            println!("Pre-repair backup: {path}");
        }
        if let Some(path) = &summary.archived_db_path {
            println!("Original database preserved at: {path}");
        }
        println!("Try running a hard repair or contact support if the issue persists.");
        Ok(1)
    }
}

fn cli_step_label(step: &DbRepairStep) -> &'static str {
    match step {
        DbRepairStep::Backup => "Backup",
        DbRepairStep::Checkpoint => "Checkpoint",
        DbRepairStep::Rebuild => "Rebuild",
        DbRepairStep::Validate => "Validate",
        DbRepairStep::Swap => "Swap",
    }
}

fn cli_status_label(state: &DbRepairStepState) -> &'static str {
    match state {
        DbRepairStepState::Pending => "pending",
        DbRepairStepState::Running => "running",
        DbRepairStepState::Success => "success",
        DbRepairStepState::Warning => "warning",
        DbRepairStepState::Skipped => "skipped",
        DbRepairStepState::Failed => "failed",
    }
}

fn print_report_json(report: &DbHealthReport) -> Result<()> {
    let json = serde_json::to_string_pretty(report).context("serialize health report")?;
    println!("{json}");
    Ok(())
}

fn print_report_table(report: &DbHealthReport) {
    println!("Database health report");
    println!("Status       : {}", status_label(&report.status));
    println!("Schema hash  : {}", report.schema_hash);
    println!("App version  : {}", report.app_version);
    println!("Generated at : {}", report.generated_at);

    println!("\nChecks:");
    println!(
        "{:<20} {:<7} {:>13}  Details",
        "Check", "Passed", "Duration (ms)"
    );
    for check in &report.checks {
        let passed = if check.passed { "yes" } else { "no" };
        let details = check
            .details
            .as_deref()
            .map(|value| value.replace('\n', " "))
            .unwrap_or_else(|| "-".to_string());
        println!(
            "{:<20} {:<7} {:>13}  {}",
            check.name, passed, check.duration_ms, details
        );
    }

    if report.offenders.is_empty() {
        println!("\nOffenders: none");
    } else {
        println!("\nOffenders:");
        println!("{:<20} {:>10}  Message", "Table", "RowID");
        for offender in &report.offenders {
            println!(
                "{:<20} {:>10}  {}",
                offender.table,
                offender.rowid,
                offender.message.replace('\n', " ")
            );
        }
    }
}

fn status_label(status: &DbHealthStatus) -> &'static str {
    match status {
        DbHealthStatus::Ok => "ok",
        DbHealthStatus::Error => "error",
    }
}

fn default_db_path() -> Result<PathBuf> {
    if let Ok(fake) = std::env::var("ARK_FAKE_APPDATA") {
        return Ok(PathBuf::from(fake).join("arklowdun.sqlite3"));
    }

    let base = dirs::data_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| anyhow::anyhow!("failed to resolve application data directory"))?;
    Ok(base.join("com.paula.arklowdun").join("arklowdun.sqlite3"))
}

async fn open_health_pool(db_path: &Path) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .log_statements(log::LevelFilter::Off);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .with_context(|| format!("open sqlite database at {}", db_path.display()))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use sqlx::ConnectOptions;
    use sqlx::Connection;
    use tempfile::tempdir;

    fn ensure_database(db_path: &Path) -> Result<()> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        tauri::async_runtime::block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full)
                .foreign_keys(true);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await?;
            pool.close().await;
            Result::<()>::Ok(())
        })
    }

    fn prepare_fk_violation(db_path: &Path) -> Result<()> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full)
                .foreign_keys(true)
                .connect()
                .await?;

            sqlx::query("PRAGMA foreign_keys = OFF;")
                .execute(&mut conn)
                .await?;
            sqlx::query("CREATE TABLE parent(id INTEGER PRIMARY KEY);")
                .execute(&mut conn)
                .await?;
            sqlx::query(
                "CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));",
            )
            .execute(&mut conn)
            .await?;
            sqlx::query("INSERT INTO child(id, parent_id) VALUES (1, 999);")
                .execute(&mut conn)
                .await?;
            sqlx::query("PRAGMA foreign_keys = ON;")
                .execute(&mut conn)
                .await?;

            conn.close().await?;
            Result::<()>::Ok(())
        })
    }

    #[test]
    fn guard_cli_db_mutation_allows_healthy_db() -> Result<()> {
        let tmp = tempdir()?;
        let db_path = tmp.path().join("arklowdun.sqlite3");
        ensure_database(&db_path)?;

        let guard = super::guard_cli_db_mutation(&db_path)?;
        let pool = guard.expect("expected healthy database guard to allow writes");
        tauri::async_runtime::block_on(async move {
            pool.close().await;
        });

        Ok(())
    }

    #[test]
    fn guard_cli_db_mutation_blocks_unhealthy_db() -> Result<()> {
        let tmp = tempdir()?;
        let db_path = tmp.path().join("arklowdun.sqlite3");
        prepare_fk_violation(&db_path)?;

        let guard = super::guard_cli_db_mutation(&db_path)?;
        match guard {
            Err(code) => assert_eq!(code, DB_UNHEALTHY_EXIT_CODE),
            Ok(_) => panic!("expected unhealthy database guard to block writes"),
        }
        Ok(())
    }
}
