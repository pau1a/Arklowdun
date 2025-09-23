// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

use arklowdun_lib::db::health::{DbHealthReport, DbHealthStatus};

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
        "{:<20} {:<7} {:>13}  {}",
        "Check", "Passed", "Duration (ms)", "Details"
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
        println!("{:<20} {:>10}  {}", "Table", "RowID", "Message");
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
