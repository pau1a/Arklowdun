use anyhow::{anyhow, Context, Result};
use arklowdun_lib::{
    events_tz_backfill::{
        run_events_backfill, BackfillOptions, BackfillProgress, MAX_CHUNK_SIZE,
        MAX_PROGRESS_INTERVAL, MIN_CHUNK_SIZE, MIN_PROGRESS_INTERVAL,
    },
    AppError,
};
use clap::Parser;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
    ConnectOptions, SqlitePool,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tracing::info;

#[derive(Parser)]
#[command(
    name = "time-backfill",
    about = "Chunked, resumable backfill for event UTC fields"
)]
struct Cli {
    /// Optional explicit DB path
    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    /// Target household identifier
    #[arg(long, value_name = "HOUSEHOLD")]
    household_id: String,

    /// Fallback timezone to use when events lack one
    #[arg(long, value_name = "TZ")]
    default_tz: Option<String>,

    /// Number of rows to process inside a single transaction
    #[arg(long, value_name = "N", default_value_t = 500)]
    chunk_size: usize,

    /// Emit progress after processing this many rows (defaults to chunk size)
    #[arg(long, value_name = "N")]
    progress_interval: Option<usize>,

    /// Compute counts without modifying the database
    #[arg(long)]
    dry_run: bool,

    /// Drop existing checkpoint state before running
    #[arg(long)]
    reset: bool,

    /// Optional override for the backfill log directory
    #[arg(long, value_name = "PATH")]
    log_dir: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    let cli = Cli::parse();
    let db_path = cli.db.unwrap_or(default_db_path()?);
    let pool = open_pool(&db_path).await?;

    if cli.chunk_size < MIN_CHUNK_SIZE || cli.chunk_size > MAX_CHUNK_SIZE {
        anyhow::bail!(
            "Chunk size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} rows per batch."
        );
    }
    let progress_interval = if let Some(interval) = cli.progress_interval {
        if interval < MIN_PROGRESS_INTERVAL || interval > MAX_PROGRESS_INTERVAL {
            anyhow::bail!(
                "Progress interval must be between {MIN_PROGRESS_INTERVAL} and {MAX_PROGRESS_INTERVAL} rows."
            );
        }
        interval
    } else {
        0
    };
    let chunk_size = cli.chunk_size;

    let progress_cb: Arc<dyn Fn(BackfillProgress) + Send + Sync> = Arc::new(|progress| {
        info!(
            target: "arklowdun::backfill",
            household_id = %progress.household_id,
            processed = progress.processed,
            total = progress.total,
            updated = progress.updated,
            skipped = progress.skipped,
            remaining = progress.remaining
        );
    });

    let summary = run_events_backfill(
        &pool,
        BackfillOptions {
            household_id: cli.household_id.clone(),
            default_tz: cli.default_tz.clone(),
            chunk_size,
            progress_interval,
            dry_run: cli.dry_run,
            reset_checkpoint: cli.reset,
        },
        cli.log_dir.clone(),
        Some(progress_cb),
    )
    .await
    .map_err(|err| anyhow!(format_cli_error(&err)))?;

    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
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
            let range = format!("{MIN_PROGRESS_INTERVAL}-{MAX_PROGRESS_INTERVAL}");
            if let Some(value) = err.context().get("progress_interval") {
                return format!(
                    "Progress interval {value} is outside the supported range ({range})."
                );
            }
            format!("{} (allowed range: {range})", err.message())
        }
        _ => err.to_string(),
    }
}
