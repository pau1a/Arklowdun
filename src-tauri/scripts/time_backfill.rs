use anyhow::{anyhow, Context, Result};
use arklowdun_lib::{
    commands,
    events_tz_backfill::{
        run_events_backfill, BackfillChunkStats, BackfillControl, BackfillOptions,
        BackfillProgress, BackfillStatus, BackfillSummary, MAX_CHUNK_SIZE,
        MAX_PROGRESS_INTERVAL_MS, MIN_CHUNK_SIZE, MIN_PROGRESS_INTERVAL_MS,
    },
    time_invariants, time_shadow, AppError,
};
use chrono::{DateTime, Utc};
use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::Serialize;
use serde_json::json;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
    ConnectOptions, Row, SqlitePool,
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
    #[command(about = "Benchmark events_list_range latency across common windows")]
    QueryBench(QueryBenchArgs),
    #[command(about = "Check wall-clock invariants between local and UTC timestamps")]
    Invariants(InvariantArgs),
    #[command(about = "Show shadow-read counters and the latest discrepancy sample")]
    ShadowReport(ShadowReportArgs),
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
struct QueryBenchArgs {
    #[arg(long, value_name = "ROWS", default_value_t = 10_000)]
    rows: usize,

    #[arg(long, value_name = "PATH")]
    fixture: Option<PathBuf>,

    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    #[arg(long, value_name = "HOUSEHOLD", default_value = "bench_hh")]
    household: String,

    #[arg(long, value_name = "N", default_value_t = 200)]
    iterations: usize,

    #[arg(long, value_name = "N", default_value_t = 3)]
    warmup: usize,

    #[arg(
        long = "window",
        value_enum,
        num_args = 1..,
        default_values_t = [QueryWindow::Day, QueryWindow::Week, QueryWindow::Month]
    )]
    windows: Vec<QueryWindow>,

    #[arg(long, value_name = "SEED", default_value_t = 42)]
    seed: u32,

    #[arg(long)]
    keep_db: bool,
}

const DAY_MS_I64: i64 = 86_400_000;
const WEEK_MS_I64: i64 = DAY_MS_I64 * 7;
const MONTH_MS_I64: i64 = DAY_MS_I64 * 30;

#[derive(Copy, Clone, Debug, ValueEnum)]
enum QueryWindow {
    Day,
    Week,
    Month,
}

impl QueryWindow {
    fn label(&self) -> &'static str {
        match self {
            QueryWindow::Day => "day",
            QueryWindow::Week => "week",
            QueryWindow::Month => "month",
        }
    }

    fn duration_ms(&self) -> i64 {
        match self {
            QueryWindow::Day => DAY_MS_I64,
            QueryWindow::Week => WEEK_MS_I64,
            QueryWindow::Month => MONTH_MS_I64,
        }
    }
}

struct QuerySample {
    elapsed_ms: f64,
    items: usize,
}

#[derive(Debug, Serialize)]
struct QueryWindowSummary {
    window: String,
    duration_ms: i64,
    iterations: usize,
    warmup: usize,
    min_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    max_ms: f64,
    mean_ms: f64,
    items_min: usize,
    items_mean: f64,
    items_p95: f64,
    items_max: usize,
    truncated: usize,
    start_min_ms: i64,
    start_max_ms: i64,
    start_min_iso: String,
    start_max_iso: String,
}

#[derive(Debug, Serialize)]
struct QueryBenchSummary {
    fixture: String,
    working_copy: String,
    household: String,
    requested_rows: usize,
    actual_rows: i64,
    iterations_per_window: usize,
    warmup: usize,
    seed: u32,
    dataset_start_ms: i64,
    dataset_end_ms: i64,
    dataset_start_iso: String,
    dataset_end_iso: String,
    dataset_span_ms: i64,
    recurrence_rows: i64,
    exdate_series: i64,
    total_queries: usize,
    windows: Vec<QueryWindowSummary>,
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

#[derive(Args)]
struct ShadowReportArgs {
    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    let cli = Cli::parse();
    match cli.command {
        Command::Backfill(args) => run_backfill(args).await?,
        Command::BackfillBench(args) => run_backfill_bench(args).await?,
        Command::QueryBench(args) => run_query_bench(args).await?,
        Command::Invariants(args) => run_invariants(args).await?,
        Command::ShadowReport(args) => run_shadow_report(args).await?,
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

async fn run_query_bench(args: QueryBenchArgs) -> Result<()> {
    let QueryBenchArgs {
        rows,
        fixture,
        db,
        household,
        iterations,
        warmup,
        windows,
        seed,
        keep_db,
    } = args;

    if iterations == 0 {
        anyhow::bail!("--iterations must be greater than zero");
    }

    if windows.is_empty() {
        anyhow::bail!("Provide at least one --window value (day, week, or month)");
    }

    let fixture_path = resolve_query_fixture_path(rows, fixture)?;
    let (work_db_path, mut temp_db) = copy_fixture_to_work(&fixture_path, db.as_deref())?;
    let pool = open_pool(&work_db_path).await?;

    let household_exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM household WHERE id = ?")
            .bind(&household)
            .fetch_one(&pool)
            .await
            .with_context(|| {
                format!(
                    "verify household {} in {}",
                    household,
                    fixture_path.display()
                )
            })?;
    if household_exists == 0 {
        anyhow::bail!(
            "Household {} not found in {}. Run the fixture generator or provide --household.",
            household,
            fixture_path.display()
        );
    }

    let counts_row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN rrule IS NOT NULL THEN 1 ELSE 0 END) as recurrences,
            SUM(CASE WHEN exdates IS NOT NULL AND TRIM(exdates) <> '' THEN 1 ELSE 0 END) as exdate_series
        FROM events
        WHERE household_id = ?
        "#
    )
    .bind(&household)
    .fetch_one(&pool)
    .await
    .with_context(|| format!("aggregate dataset stats for {}", household))?;

    let actual_rows = counts_row.try_get::<i64, _>("total").unwrap_or(0);
    if actual_rows == 0 {
        anyhow::bail!("Household {} has no events to benchmark", household);
    }
    let recurrence_rows = counts_row
        .try_get::<Option<i64>, _>("recurrences")
        .unwrap_or(None)
        .unwrap_or(0);
    let exdate_series = counts_row
        .try_get::<Option<i64>, _>("exdate_series")
        .unwrap_or(None)
        .unwrap_or(0);

    let bounds_row = sqlx::query(
        r#"
        SELECT
            MIN(start_at) as min_start,
            MAX(COALESCE(end_at, start_at)) as max_end
        FROM events
        WHERE household_id = ?
        "#,
    )
    .bind(&household)
    .fetch_one(&pool)
    .await
    .with_context(|| format!("load range bounds for {}", household))?;

    let dataset_start_ms = bounds_row
        .try_get::<Option<i64>, _>("min_start")
        .unwrap_or(None)
        .ok_or_else(|| anyhow!("Household {} has no start_at values", household))?;
    let dataset_end_ms = bounds_row
        .try_get::<Option<i64>, _>("max_end")
        .unwrap_or(None)
        .ok_or_else(|| anyhow!("Household {} has no end bounds", household))?;
    if dataset_end_ms < dataset_start_ms {
        anyhow::bail!(
            "Dataset bounds are inverted: start {} > end {}",
            dataset_start_ms,
            dataset_end_ms
        );
    }

    let span_days = (dataset_end_ms - dataset_start_ms) as f64 / DAY_MS_I64 as f64;
    let window_labels: Vec<&str> = windows.iter().map(|w| w.label()).collect();

    println!("Query latency benchmark");
    println!("  Fixture:           {}", fixture_path.display());
    println!("  Working copy:      {}", work_db_path.display());
    println!("  Household:         {}", household);
    println!("  Requested rows:    {}", rows);
    println!("  Actual rows:       {}", actual_rows);
    println!("  Recurrence rows:   {}", recurrence_rows);
    println!("  Series with EXDATEs: {}", exdate_series);
    println!(
        "  Dataset span:      {} → {} ({:.2} days)",
        ms_to_iso(dataset_start_ms),
        ms_to_iso(dataset_end_ms),
        span_days.max(0.0)
    );
    println!("  Windows:           {}", window_labels.join(", "));
    println!(
        "  Iterations:        {} (warmup {} per window)",
        iterations, warmup
    );
    println!("  Seed:              {}", seed);

    let mut window_summaries = Vec::with_capacity(windows.len());

    for (index, window) in windows.iter().enumerate() {
        let duration_ms = window.duration_ms();
        let span_ms = dataset_end_ms.saturating_sub(dataset_start_ms);
        if span_ms < duration_ms {
            anyhow::bail!(
                "Window {} ({duration_ms} ms) exceeds dataset span of {span_ms} ms",
                window.label()
            );
        }

        let candidates = build_window_candidates(dataset_start_ms, dataset_end_ms, duration_ms);
        if candidates.is_empty() {
            anyhow::bail!(
                "No candidate start times available for window {}",
                window.label()
            );
        }

        let mut rng = Mulberry32::from_parts(seed, index as u32 + 1);

        for _ in 0..warmup {
            let start = sample_start(&mut rng, &candidates);
            let end = start.saturating_add(duration_ms);
            let _ = commands::events_list_range_command(&pool, &household, start, end)
                .await
                .map_err(|err| anyhow!(format_cli_error(&err)))?;
        }

        let mut samples = Vec::with_capacity(iterations);
        let mut start_min_obs = i64::MAX;
        let mut start_max_obs = i64::MIN;
        let mut truncated = 0usize;

        for _ in 0..iterations {
            let start = sample_start(&mut rng, &candidates);
            let end = start.saturating_add(duration_ms);
            let started = Instant::now();
            let response = commands::events_list_range_command(&pool, &household, start, end)
                .await
                .map_err(|err| anyhow!(format_cli_error(&err)))?;
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            if response.truncated {
                truncated += 1;
            }
            start_min_obs = start_min_obs.min(start);
            start_max_obs = start_max_obs.max(start);
            samples.push(QuerySample {
                elapsed_ms: elapsed,
                items: response.items.len(),
            });
        }

        let latencies: Vec<f64> = samples.iter().map(|s| s.elapsed_ms).collect();
        let counts: Vec<f64> = samples.iter().map(|s| s.items as f64).collect();
        let min_ms = latencies.iter().copied().reduce(f64::min).unwrap_or(0.0);
        let max_ms = latencies.iter().copied().reduce(f64::max).unwrap_or(0.0);
        let mean_ms = if latencies.is_empty() {
            0.0
        } else {
            latencies.iter().sum::<f64>() / latencies.len() as f64
        };
        let p50_ms = percentile_f64(&latencies, 50.0).unwrap_or(min_ms);
        let p95_ms = percentile_f64(&latencies, 95.0).unwrap_or(max_ms);

        let items_min = samples.iter().map(|s| s.items).min().unwrap_or(0);
        let items_max = samples.iter().map(|s| s.items).max().unwrap_or(0);
        let items_mean = if counts.is_empty() {
            0.0
        } else {
            counts.iter().sum::<f64>() / counts.len() as f64
        };
        let items_p95 = percentile_f64(&counts, 95.0).unwrap_or(items_mean);

        let start_min_obs = if start_min_obs == i64::MAX {
            dataset_start_ms
        } else {
            start_min_obs
        };
        let start_max_obs = if start_max_obs == i64::MIN {
            dataset_start_ms
        } else {
            start_max_obs
        };

        println!("\nWindow: {} ({} ms)", window.label(), duration_ms);
        println!(
            "  Start range: {} → {}",
            ms_to_iso(start_min_obs),
            ms_to_iso(start_max_obs)
        );
        println!(
            "  Latency (ms): min {:.2} | p50 {:.2} | p95 {:.2} | max {:.2}",
            min_ms, p50_ms, p95_ms, max_ms
        );
        println!("  Latency mean: {:.2} ms", mean_ms);
        println!(
            "  Items returned: min {} | avg {:.1} | p95 {:.1} | max {}",
            items_min, items_mean, items_p95, items_max
        );
        println!("  Truncated responses: {}", truncated);

        window_summaries.push(QueryWindowSummary {
            window: window.label().to_string(),
            duration_ms,
            iterations,
            warmup,
            min_ms,
            p50_ms,
            p95_ms,
            max_ms,
            mean_ms,
            items_min,
            items_mean,
            items_p95,
            items_max,
            truncated,
            start_min_ms: start_min_obs,
            start_max_ms: start_max_obs,
            start_min_iso: ms_to_iso(start_min_obs),
            start_max_iso: ms_to_iso(start_max_obs),
        });
    }

    let summary = QueryBenchSummary {
        fixture: fixture_path.display().to_string(),
        working_copy: work_db_path.display().to_string(),
        household: household.clone(),
        requested_rows: rows,
        actual_rows,
        iterations_per_window: iterations,
        warmup,
        seed,
        dataset_start_ms,
        dataset_end_ms,
        dataset_start_iso: ms_to_iso(dataset_start_ms),
        dataset_end_iso: ms_to_iso(dataset_end_ms),
        dataset_span_ms: dataset_end_ms.saturating_sub(dataset_start_ms),
        recurrence_rows,
        exdate_series,
        total_queries: windows.len() * iterations,
        windows: window_summaries,
    };

    println!("\n{}", serde_json::to_string(&summary)?);

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

    pool.close().await;

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

fn default_query_fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
        .join("time")
        .join("query")
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

fn resolve_query_fixture_path(rows: usize, explicit: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        let candidate = path.canonicalize().unwrap_or(path.clone());
        if candidate.exists() {
            return Ok(candidate);
        }
        anyhow::bail!("Fixture override {} does not exist", path.display());
    }

    let candidate =
        default_query_fixture_dir().join(format!("query-{}.sqlite3", dataset_suffix(rows)));
    if candidate.exists() {
        return Ok(candidate.canonicalize().unwrap_or(candidate));
    }
    anyhow::bail!(
        "No query fixture available for {rows} rows at {}. Run `node --loader ts-node/esm scripts/bench/generate_query_fixture.ts --rows {rows}` or provide --fixture.",
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

fn align_to_midnight_ms(ms: i64) -> i64 {
    ms - ms.rem_euclid(DAY_MS_I64)
}

fn build_window_candidates(min_start: i64, max_end: i64, duration_ms: i64) -> Vec<i64> {
    if duration_ms <= 0 {
        return vec![min_start];
    }
    let start_min = align_to_midnight_ms(min_start);
    let mut start_max = align_to_midnight_ms(max_end.saturating_sub(duration_ms));
    if start_max < start_min {
        start_max = start_min;
    }

    let mut values = Vec::new();
    values.push(start_min);
    let mut current = start_min;
    while current < start_max {
        match current.checked_add(DAY_MS_I64) {
            Some(next) if next < start_max => {
                values.push(next);
                current = next;
            }
            _ => break,
        }
    }
    if *values.last().unwrap_or(&start_min) != start_max {
        values.push(start_max);
    }
    values.sort_unstable();
    values.dedup();
    values
}

fn sample_start(rng: &mut Mulberry32, candidates: &[i64]) -> i64 {
    if candidates.is_empty() {
        return 0;
    }
    let idx = rng.next_usize(candidates.len().saturating_sub(1));
    candidates[idx]
}

fn ms_to_iso(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_else(|| ms.to_string())
}

fn percentile_f64(samples: &[f64], percentile: f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    if percentile <= 0.0 {
        return samples
            .iter()
            .filter(|v| v.is_finite())
            .copied()
            .reduce(f64::min);
    }
    if percentile >= 100.0 {
        return samples
            .iter()
            .filter(|v| v.is_finite())
            .copied()
            .reduce(f64::max);
    }

    let mut filtered: Vec<f64> = samples.iter().copied().filter(|v| v.is_finite()).collect();
    if filtered.is_empty() {
        return None;
    }
    filtered.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = percentile / 100.0 * (filtered.len() - 1) as f64;
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;
    if lower == upper {
        return filtered.get(lower).copied();
    }
    let lower_val = filtered[lower];
    let upper_val = filtered[upper];
    let weight = rank - lower as f64;
    Some(lower_val + (upper_val - lower_val) * weight)
}

#[derive(Clone)]
struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    fn from_parts(seed: u32, stream: u32) -> Self {
        let mixed = seed.wrapping_add(stream.wrapping_mul(0x9E37_79B9));
        Self { state: mixed }
    }

    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut t = self.state ^ (self.state >> 15);
        t = t.wrapping_mul(1 | self.state);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t));
        t ^ (t >> 14)
    }

    fn next_f64(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }

    fn next_usize(&mut self, upper_inclusive: usize) -> usize {
        if upper_inclusive == 0 {
            return 0;
        }
        let upper = upper_inclusive + 1;
        let mut idx = (self.next_f64() * upper as f64) as usize;
        if idx >= upper {
            idx = upper - 1;
        }
        idx
    }
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

async fn run_shadow_report(args: ShadowReportArgs) -> Result<()> {
    let db_path = args.db.unwrap_or(default_db_path()?);
    let pool = open_pool(&db_path).await?;

    let summary = time_shadow::load_summary(&pool).await?;
    let mode = if time_shadow::is_shadow_read_enabled() {
        "on"
    } else {
        "off"
    };

    println!("Shadow-read mode: {mode}");
    println!("Total rows inspected: {}", summary.total_rows);
    println!("Discrepancies detected: {}", summary.discrepancies);

    match summary.last {
        Some(sample) => {
            println!("\nLast discrepancy:");
            println!("  Event ID: {}", sample.event_id);
            println!("  Household: {}", sample.household_id);
            if let Some(tz) = sample.tz.as_deref() {
                if !tz.is_empty() {
                    println!("  Timezone: {tz}");
                }
            }
            if let Some(delta) = sample.start_delta_ms {
                println!("  Start delta (ms): {delta}");
                println!(
                    "    Legacy start (ms): {}",
                    sample
                        .legacy_start_ms
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "n/a".into())
                );
                println!(
                    "    UTC start (ms): {}",
                    sample
                        .utc_start_ms
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "n/a".into())
                );
            }
            if let Some(delta) = sample.end_delta_ms {
                println!("  End delta (ms): {delta}");
                println!(
                    "    Legacy end (ms): {}",
                    sample
                        .legacy_end_ms
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "n/a".into())
                );
                println!(
                    "    UTC end (ms): {}",
                    sample
                        .utc_end_ms
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "n/a".into())
                );
            }
            if let Some(observed) = sample.observed_at_ms {
                println!("  Observed at (ms): {observed}");
            }
        }
        None => {
            println!("\nNo discrepancies recorded.");
        }
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
