#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::time::Instant;

use anyhow::Context;
use arklowdun_lib::commands::{self, EVENTS_LIST_RANGE_TOTAL_LIMIT};
use clap::{Parser, ValueEnum};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

#[derive(Parser, Debug)]
#[command(name = "recurrence-bench", about = "Benchmark RRULE expansion limits")]
struct Args {
    /// Which scenario to execute. Use `all` to run both.
    #[arg(long, value_enum, default_value_t = Scenario::All)]
    scenario: Scenario,

    /// Number of iterations to run for each selected scenario.
    #[arg(long, default_value_t = 1)]
    runs: usize,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
enum Scenario {
    Series,
    Query,
    All,
}

#[derive(Debug, Default, Clone, Copy)]
struct MemoryStats {
    rss_kb: u64,
    hwm_kb: u64,
}

const CREATE_EVENTS_TABLE: &str = "\
    CREATE TABLE events (\
        id TEXT PRIMARY KEY,\
        household_id TEXT NOT NULL,\
        title TEXT NOT NULL,\
        start_at INTEGER NOT NULL,\
        end_at INTEGER,\
        tz TEXT,\
        start_at_utc INTEGER,\
        end_at_utc INTEGER,\
        rrule TEXT,\
        exdates TEXT,\
        reminder INTEGER,\
        created_at INTEGER NOT NULL,\
        updated_at INTEGER NOT NULL,\
        deleted_at INTEGER\
    )\
";

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let scenarios: &[Scenario] = match args.scenario {
        Scenario::Series => &[Scenario::Series],
        Scenario::Query => &[Scenario::Query],
        Scenario::All => &[Scenario::Series, Scenario::Query],
    };

    println!("scenario,run,expanded,truncated,elapsed_ms,rss_kb,rss_delta_kb,hwm_kb");

    for scenario in scenarios {
        for run in 1..=args.runs {
            let sample = match scenario {
                Scenario::Series => run_series_benchmark().await?,
                Scenario::Query => run_query_benchmark().await?,
                Scenario::All => unreachable!(),
            };
            println!(
                "{scenario:?},{run},{},{},{:.3},{},{},{}",
                sample.expanded,
                sample.truncated,
                sample.elapsed_ms,
                sample.memory_after.rss_kb,
                sample
                    .memory_after
                    .rss_kb
                    .saturating_sub(sample.memory_before.rss_kb),
                sample.memory_after.hwm_kb,
            );
        }
    }

    Ok(())
}

#[derive(Debug)]
struct BenchmarkSample {
    expanded: usize,
    truncated: bool,
    elapsed_ms: f64,
    memory_before: MemoryStats,
    memory_after: MemoryStats,
}

async fn setup_pool() -> anyhow::Result<SqlitePool> {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .context("create in-memory sqlite pool")?;
    sqlx::query(CREATE_EVENTS_TABLE)
        .execute(&pool)
        .await
        .context("create events table")?;
    Ok(pool)
}

async fn run_series_benchmark() -> anyhow::Result<BenchmarkSample> {
    let pool = setup_pool().await?;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
         VALUES ('series', 'HH', 'Minutely stress', 0, 60000, 'UTC', 0, 60000, 'FREQ=MINUTELY;COUNT=1000', 0, 0)",
    )
    .execute(&pool)
    .await
    .context("insert stress event")?;

    let memory_before = read_memory_stats().unwrap_or_default();
    let began = Instant::now();
    let response =
        commands::events_list_range_command(&pool, "HH", -60_000, (1_000_i64 + 1) * 60_000).await?;
    let elapsed = began.elapsed();
    let memory_after = read_memory_stats().unwrap_or_default();

    anyhow::ensure!(
        response.items.len() == 500,
        "series benchmark expected 500 instances, saw {}",
        response.items.len()
    );
    anyhow::ensure!(
        response.truncated,
        "series benchmark must trigger truncation"
    );

    Ok(BenchmarkSample {
        expanded: response.items.len(),
        truncated: response.truncated,
        elapsed_ms: elapsed.as_secs_f64() * 1_000.0,
        memory_before,
        memory_after,
    })
}

async fn run_query_benchmark() -> anyhow::Result<BenchmarkSample> {
    let pool = setup_pool().await?;
    let series_count = 32usize;
    for idx in 0..series_count {
        let start_at = (idx as i64) * 60_000;
        sqlx::query(
            "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
             VALUES (?1, 'HH', ?2, ?3, ?4, 'UTC', ?3, ?4, 'FREQ=MINUTELY;COUNT=1000', 0, 0)",
        )
        .bind(format!("series-{idx}"))
        .bind(format!("Series {idx}"))
        .bind(start_at)
        .bind(start_at + 60_000)
        .execute(&pool)
        .await
        .with_context(|| format!("insert stress series {idx}"))?;
    }

    let memory_before = read_memory_stats().unwrap_or_default();
    let began = Instant::now();
    let response = commands::events_list_range_command(
        &pool,
        "HH",
        -60_000,
        ((series_count as i64) + 1_000) * 60_000,
    )
    .await?;
    let elapsed = began.elapsed();
    let memory_after = read_memory_stats().unwrap_or_default();

    anyhow::ensure!(
        response.items.len() == EVENTS_LIST_RANGE_TOTAL_LIMIT,
        "query benchmark expected {EVENTS_LIST_RANGE_TOTAL_LIMIT} instances, saw {}",
        response.items.len()
    );
    anyhow::ensure!(
        response.truncated,
        "query benchmark must trigger truncation"
    );

    Ok(BenchmarkSample {
        expanded: response.items.len(),
        truncated: response.truncated,
        elapsed_ms: elapsed.as_secs_f64() * 1_000.0,
        memory_before,
        memory_after,
    })
}

fn read_memory_stats() -> Option<MemoryStats> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let mut stats = MemoryStats::default();
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            if let Some(kb) = parse_kb(rest) {
                stats.rss_kb = kb;
            }
        } else if let Some(rest) = line.strip_prefix("VmHWM:") {
            if let Some(kb) = parse_kb(rest) {
                stats.hwm_kb = kb;
            }
        }
    }
    Some(stats)
}

fn parse_kb(fragment: &str) -> Option<u64> {
    let trimmed = fragment.trim();
    let value = trimmed
        .split_whitespace()
        .next()
        .and_then(|val| val.parse::<u64>().ok());
    value
}
