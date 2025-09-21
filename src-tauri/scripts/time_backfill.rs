use anyhow::{anyhow, Context, Result};
use arklowdun_lib::{
    events_tz_backfill::{
        run_events_backfill, BackfillChunkStats, BackfillControl, BackfillOptions,
        BackfillProgress, BackfillStatus, BackfillSummary, MAX_CHUNK_SIZE,
        MAX_PROGRESS_INTERVAL_MS, MIN_CHUNK_SIZE, MIN_PROGRESS_INTERVAL_MS,
    },
    time_invariants, AppError,
};
use clap::{Args, Parser, Subcommand};
use serde_json::json;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
    ConnectOptions, SqlitePool,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tempfile::{Builder, NamedTempFile};
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
    #[command(about = "Run throughput benchmarks against fixture datasets")]
    BackfillBench(BenchArgs),
    #[command(about = "Check wall-clock invariants between local and UTC timestamps")]
    Invariants(InvariantArgs),
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

#[derive(Args)]
struct BenchArgs {
    #[arg(long, value_name = "ROWS", default_value_t = 10_000)]
    rows: usize,

    #[arg(long, value_name = "PATH")]
    fixture: Option<PathBuf>,

    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    #[arg(long, value_name = "N", default_value_t = 500)]
    chunk_size: usize,

    #[arg(long)]
    dry_run: bool,

    #[arg(long, value_name = "TZ")]
    default_tz: Option<String>,

    #[arg(long, value_name = "HOUSEHOLD")]
    household: Option<String>,

    #[arg(long)]
    keep_db: bool,

    #[arg(long, value_name = "MS")]
    progress_interval: Option<u64>,
}

#[derive(Args)]
struct InvariantArgs {
    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    #[arg(long, value_name = "PATH", default_value = "drift-report.json")]
    output: PathBuf,

    #[arg(long, value_name = "HOUSEHOLD")]
    household: Option<String>,

    #[arg(long)]
    pretty: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    let cli = Cli::parse();
    match cli.command {
        Command::Backfill(args) => run_backfill(args).await?,
        Command::BackfillBench(args) => run_backfill_bench(args).await?,
        Command::Invariants(args) => run_invariants(args).await?,
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
        if interval != 0
            && !(MIN_PROGRESS_INTERVAL_MS..=MAX_PROGRESS_INTERVAL_MS).contains(&interval)
        {
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
        None,
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

async fn run_backfill_bench(args: BenchArgs) -> Result<()> {
    let BenchArgs {
        rows,
        fixture,
        db,
        chunk_size,
        dry_run,
        default_tz,
        household,
        keep_db,
        progress_interval,
    } = args;

    if !(MIN_CHUNK_SIZE..=MAX_CHUNK_SIZE).contains(&chunk_size) {
        anyhow::bail!(
            "Chunk size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} rows per batch."
        );
    }

    if let Some(interval) = progress_interval {
        if interval != 0
            && !(MIN_PROGRESS_INTERVAL_MS..=MAX_PROGRESS_INTERVAL_MS).contains(&interval)
        {
            anyhow::bail!(
                "Progress interval must be between {MIN_PROGRESS_INTERVAL_MS} and {MAX_PROGRESS_INTERVAL_MS} milliseconds."
            );
        }
    }

    let fixture_path = resolve_fixture_path(rows, fixture)?;
    let (work_db_path, mut temp_db) = copy_fixture_to_work(&fixture_path, db.as_deref())?;
    let pool = open_pool(&work_db_path).await?;

    let household_id = if let Some(id) = household {
        id
    } else {
        sqlx::query_scalar::<_, String>("SELECT id FROM household ORDER BY id LIMIT 1")
            .fetch_optional(&pool)
            .await
            .with_context(|| format!("load household id from {}", work_db_path.display()))?
            .ok_or_else(|| {
                anyhow!(
                    "Fixture {} does not contain any household rows",
                    fixture_path.display()
                )
            })?
    };

    let chunk_samples: Arc<Mutex<Vec<BackfillChunkStats>>> = Arc::new(Mutex::new(Vec::new()));
    let chunk_capture = chunk_samples.clone();
    let chunk_observer: Arc<dyn Fn(BackfillChunkStats) + Send + Sync> = Arc::new(move |chunk| {
        if let Ok(mut guard) = chunk_capture.lock() {
            guard.push(chunk);
        }
    });

    let progress_ms = progress_interval.unwrap_or(0);

    let summary = run_events_backfill(
        &pool,
        BackfillOptions {
            household_id: household_id.clone(),
            default_tz: default_tz.clone(),
            chunk_size,
            progress_interval_ms: progress_ms,
            dry_run,
            reset_checkpoint: true,
        },
        None,
        None,
        None,
        Some(chunk_observer),
    )
    .await
    .map_err(|err| anyhow!(format_cli_error(&err)))?;

    pool.close().await;

    let mut chunks = chunk_samples
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    chunks.sort_by_key(|c| c.chunk_index);

    let chunk_count = chunks.len();
    let chunk_times: Vec<u64> = chunks.iter().map(|c| c.elapsed_ms).collect();
    let avg_chunk_ms = if chunk_count == 0 {
        0.0
    } else {
        chunk_times.iter().sum::<u64>() as f64 / chunk_count as f64
    };
    let p95_chunk_ms = percentile_ms(&chunk_times, 95.0);
    let max_chunk_ms = chunk_times.iter().copied().max().unwrap_or(0);
    let throughput = if summary.elapsed_ms == 0 {
        0.0
    } else {
        summary.total_scanned as f64 / (summary.elapsed_ms as f64 / 1000.0)
    };

    println!("Benchmark summary");
    println!("  Fixture:        {}", fixture_path.display());
    println!("  Working copy:   {}", work_db_path.display());
    println!("  Household:      {}", household_id);
    println!("  Requested rows: {}", rows);
    println!("  Chunk size:     {}", chunk_size);
    println!("  Dry run:        {}", dry_run);
    println!("  Progress ms:    {}", progress_ms);
    println!("  Scanned:        {}", summary.total_scanned);
    println!("  Updated:        {}", summary.total_updated);
    println!("  Skipped:        {}", summary.total_skipped);
    println!(
        "  Elapsed:        {:.3}s",
        summary.elapsed_ms as f64 / 1000.0
    );
    println!("  Throughput:     {:.2} rows/sec", throughput);
    println!("  Chunks:         {}", chunk_count);
    println!("  Avg chunk:      {:.2} ms", avg_chunk_ms);
    if let Some(p95) = p95_chunk_ms {
        println!("  p95 chunk:      {:.2} ms", p95);
    }
    println!("  Max chunk:      {} ms", max_chunk_ms);

    println!("\nchunk_index,scanned,updated,skipped,elapsed_ms");
    for chunk in &chunks {
        println!(
            "{},{},{},{},{}",
            chunk.chunk_index, chunk.scanned, chunk.updated, chunk.skipped, chunk.elapsed_ms
        );
    }

    if keep_db {
        if let Some(temp) = temp_db.take() {
            let (_file, path) = temp.keep().with_context(|| {
                format!("persist benchmark database at {}", work_db_path.display())
            })?;
            eprintln!("Kept working database at {}", path.display());
        } else if let Some(dest) = &db {
            eprintln!("Working database retained at {}", dest.display());
        }
    }

    Ok(())
}

fn dataset_suffix(rows: usize) -> String {
    if rows >= 1_000 && rows % 1_000 == 0 {
        format!("{}k", rows / 1_000)
    } else {
        rows.to_string()
    }
}

fn default_fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
        .join("time")
        .join("backfill")
}

fn resolve_fixture_path(rows: usize, explicit: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        let candidate = path.canonicalize().unwrap_or(path.clone());
        if candidate.exists() {
            return Ok(candidate);
        }
        anyhow::bail!("Fixture override {} does not exist", path.display());
    }

    let candidate =
        default_fixture_dir().join(format!("backfill-{}.sqlite3", dataset_suffix(rows)));
    if candidate.exists() {
        return Ok(candidate.canonicalize().unwrap_or(candidate));
    }
    anyhow::bail!(
        "No fixture available for {rows} rows at {}. Run `node --loader ts-node/esm scripts/bench/generate_backfill_fixture.ts --rows {rows}` or provide --fixture to supply a database.",
        candidate.display()
    );
}

fn copy_fixture_to_work(
    fixture: &Path,
    override_path: Option<&Path>,
) -> Result<(PathBuf, Option<NamedTempFile>)> {
    if let Some(dest) = override_path {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create directory {}", parent.display()))?;
        }
        fs::copy(fixture, dest)
            .with_context(|| format!("copy fixture {} to {}", fixture.display(), dest.display()))?;
        return Ok((dest.to_path_buf(), None));
    }

    let temp = Builder::new()
        .prefix("backfill_bench_")
        .suffix(".sqlite3")
        .tempfile()
        .context("create temporary benchmark database")?;
    fs::copy(fixture, temp.path()).with_context(|| {
        format!(
            "copy fixture {} to {}",
            fixture.display(),
            temp.path().display()
        )
    })?;
    Ok((temp.path().to_path_buf(), Some(temp)))
}

fn percentile_ms(samples: &[u64], percentile: f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }

    if percentile <= 0.0 {
        return samples.iter().copied().min().map(|v| v as f64);
    }
    if percentile >= 100.0 {
        return samples.iter().copied().max().map(|v| v as f64);
    }

    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let rank = percentile / 100.0 * (sorted.len() - 1) as f64;
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;
    if lower == upper {
        return Some(sorted[lower] as f64);
    }
    let lower_val = sorted[lower] as f64;
    let upper_val = sorted[upper] as f64;
    let weight = rank - lower as f64;
    Some(lower_val + (upper_val - lower_val) * weight)
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

async fn run_invariants(args: InvariantArgs) -> Result<()> {
    let db_path = args.db.unwrap_or(default_db_path()?);
    let pool = open_pool(&db_path).await?;
    let options = time_invariants::DriftCheckOptions {
        household_id: args.household.clone(),
    };
    let started = Instant::now();
    let report = time_invariants::run_drift_check(&pool, options).await?;
    let elapsed = started.elapsed();

    println!("{}", time_invariants::format_human_summary(&report));
    if report.drift_events.is_empty() {
        println!("✅ No drift detected (0 offending events)");
    } else {
        println!(
            "❌ Drift detected ({} offending events)",
            report.drift_events.len()
        );
    }
    println!("Elapsed: {:.2}s", elapsed.as_secs_f64());

    let json = if args.pretty {
        serde_json::to_vec_pretty(&report.drift_events)?
    } else {
        serde_json::to_vec(&report.drift_events)?
    };
    std::fs::write(&args.output, &json)
        .with_context(|| format!("write {}", args.output.display()))?;
    eprintln!(
        "Wrote {} drift events to {}",
        report.drift_events.len(),
        args.output.display()
    );

    if !report.drift_events.is_empty() {
        std::process::exit(2);
    }

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
