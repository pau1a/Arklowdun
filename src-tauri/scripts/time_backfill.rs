use anyhow::{anyhow, Context, Result};
use arklowdun_lib::{
    events_tz_backfill::{
        run_events_backfill, BackfillControl, BackfillOptions, BackfillProgress, BackfillStatus,
        BackfillSummary, MAX_CHUNK_SIZE, MAX_PROGRESS_INTERVAL_MS, MIN_CHUNK_SIZE,
        MIN_PROGRESS_INTERVAL_MS,
    },
    AppError,
};
use clap::{Args, Parser, Subcommand};
use serde_json::json;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
    ConnectOptions, SqlitePool,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::signal;
use tracing::info;

#[derive(Parser)]
#[command(name = "time", about = "Timekeeping maintenance utilities")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    #[command(about = "Run the timezone backfill with progress reporting")]
    Backfill(BackfillArgs),
}

#[derive(Args)]
struct BackfillArgs {
    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    #[arg(long, value_name = "HOUSEHOLD")]
    household: String,

    #[arg(long, value_name = "TZ")]
    default_tz: Option<String>,

    #[arg(long, value_name = "N", default_value_t = 500)]
    chunk_size: usize,

    #[arg(long, value_name = "MS")]
    progress_interval: Option<u64>,

    #[arg(long)]
    dry_run: bool,

    #[arg(long)]
    resume: bool,

    #[arg(long)]
    json_summary: bool,

    #[arg(long, value_name = "PATH")]
    log_dir: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    let cli = Cli::parse();
    match cli.command {
        Command::Backfill(args) => run_backfill(args).await?,
    }

    Ok(())
}

async fn run_backfill(args: BackfillArgs) -> Result<()> {
    let db_path = args.db.unwrap_or(default_db_path()?);
    let pool = open_pool(&db_path).await?;

    if !(MIN_CHUNK_SIZE..=MAX_CHUNK_SIZE).contains(&args.chunk_size) {
        anyhow::bail!(
            "Chunk size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} rows per batch."
        );
    }

    if let Some(interval) = args.progress_interval {
        if !(MIN_PROGRESS_INTERVAL_MS..=MAX_PROGRESS_INTERVAL_MS).contains(&interval) {
            anyhow::bail!(
                "Progress interval must be between {MIN_PROGRESS_INTERVAL_MS} and {MAX_PROGRESS_INTERVAL_MS} milliseconds."
            );
        }
    }

    let control = BackfillControl::new();
    let progress_cb: Arc<dyn Fn(BackfillProgress) + Send + Sync> = Arc::new(|progress| {
        let event = json!({
            "type": "progress",
            "household_id": progress.household_id,
            "scanned": progress.scanned,
            "updated": progress.updated,
            "skipped": progress.skipped,
            "remaining": progress.remaining,
            "elapsed_ms": progress.elapsed_ms,
            "chunk_size": progress.chunk_size,
        });
        println!("{}", event);
        info!(
            target: "arklowdun::backfill",
            household_id = %progress.household_id,
            scanned = progress.scanned,
            updated = progress.updated,
            skipped = progress.skipped,
            remaining = progress.remaining,
            elapsed_ms = progress.elapsed_ms,
            chunk_size = progress.chunk_size,
            "progress"
        );
    });

    let backfill_future = run_events_backfill(
        &pool,
        BackfillOptions {
            household_id: args.household.clone(),
            default_tz: args.default_tz.clone(),
            chunk_size: args.chunk_size,
            progress_interval_ms: args.progress_interval.unwrap_or(0),
            dry_run: args.dry_run,
            reset_checkpoint: !args.resume,
        },
        args.log_dir.clone(),
        Some(control.clone()),
        Some(progress_cb),
    );

    tokio::pin!(backfill_future);
    let summary_result = loop {
        tokio::select! {
            result = &mut backfill_future => break result,
            signal = signal::ctrl_c() => {
                signal.expect("install Ctrl+C handler");
                if !control.is_cancelled() {
                    eprintln!("Received interrupt. Finishing current chunk before exiting…");
                    control.cancel();
                }
            }
        }
    };

    let summary = summary_result.map_err(|err| anyhow!(format_cli_error(&err)))?;
    emit_summary_event(&summary);
    if !args.json_summary {
        print_human_summary(&summary);
    }

    let exit_code = match summary.status {
        BackfillStatus::Completed => 0,
        BackfillStatus::Cancelled => 130,
        BackfillStatus::Failed => 1,
    };

    if exit_code != 0 {
        std::process::exit(exit_code);
    }

    Ok(())
}

fn emit_summary_event(summary: &BackfillSummary) {
    let event = json!({
        "type": "summary",
        "household_id": summary.household_id,
        "scanned": summary.total_scanned,
        "updated": summary.total_updated,
        "skipped": summary.total_skipped,
        "elapsed_ms": summary.elapsed_ms,
        "status": summary.status,
    });
    println!("{}", event);
}

fn print_human_summary(summary: &BackfillSummary) {
    eprintln!("\nSummary ({})", format_status(&summary.status));
    eprintln!("  Household: {}", summary.household_id);
    eprintln!("  Scanned:   {}", summary.total_scanned);
    eprintln!("  Updated:   {}", summary.total_updated);
    eprintln!("  Skipped:   {}", summary.total_skipped);
    eprintln!("  Elapsed:   {:.2}s", summary.elapsed_ms as f64 / 1000.0);
    eprintln!();
}

fn format_status(status: &BackfillStatus) -> &'static str {
    match status {
        BackfillStatus::Completed => "completed",
        BackfillStatus::Cancelled => "cancelled",
        BackfillStatus::Failed => "failed",
    }
}

fn init_logging() {
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
}

fn default_db_path() -> Result<PathBuf> {
    let base = dirs::data_dir().unwrap_or(std::env::current_dir()?);
    Ok(base.join("com.paula.arklowdun").join("arklowdun.sqlite3"))
}

async fn open_pool(db: &Path) -> Result<SqlitePool> {
    if !db.exists() {
        anyhow::bail!("database not found: {}", db.display());
    }
    let opts = SqliteConnectOptions::new()
        .filename(db)
        .create_if_missing(false)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .log_statements(log::LevelFilter::Off);
    let pool = SqlitePool::connect_with(opts)
        .await
        .with_context(|| format!("open {}", db.display()))?;
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

fn format_cli_error(err: &AppError) -> String {
    match err.code() {
        "BACKFILL/INVALID_TIMEZONE" => {
            if let Some(tz) = err.context().get("timezone") {
                return format!("Invalid timezone '{tz}'. Use an IANA zone like 'Europe/London'.");
            }
            format!("{} Use an IANA zone like 'Europe/London'.", err.message())
        }
        "BACKFILL/INVALID_CHUNK_SIZE" => {
            let range = format!("{MIN_CHUNK_SIZE}-{MAX_CHUNK_SIZE}");
            if let Some(value) = err.context().get("chunk_size") {
                return format!("Chunk size {value} is outside the supported range ({range}).");
            }
            format!("{} (allowed range: {range})", err.message())
        }
        "BACKFILL/INVALID_PROGRESS_INTERVAL" => {
            let range = format!("{MIN_PROGRESS_INTERVAL_MS}-{MAX_PROGRESS_INTERVAL_MS}");
            if let Some(value) = err.context().get("progress_interval") {
                return format!(
                    "Progress interval {value}ms is outside the supported range ({range}ms)."
                );
            }
            format!("{} (allowed range: {range}ms)", err.message())
        }
        _ => err.to_string(),
    }
}
