import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturesDir = path.join(repoRoot, "fixtures", "time", "query");
const testResultsDir = path.join(repoRoot, "test-results");
const logPath = path.join(testResultsDir, "query-perf-smoke.json");

const ROWS = Number.parseInt(process.env.QUERY_PERF_ROWS ?? "1000", 10);
const ITERATIONS = Number.parseInt(process.env.QUERY_PERF_ITERATIONS ?? "30", 10);
const WARMUP = Number.parseInt(process.env.QUERY_PERF_WARMUP ?? "5", 10);
const WINDOWS = (process.env.QUERY_PERF_WINDOWS ?? "day,week,month")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const SEED = Number.parseInt(process.env.QUERY_PERF_SEED ?? "42", 10);
const FIXTURE_SEED = Number.parseInt(process.env.QUERY_PERF_FIXTURE_SEED ?? "104729", 10);
const THRESHOLD_MS = Number.parseFloat(process.env.QUERY_PERF_THRESHOLD_MS ?? "500");
const JOB_LABEL = "gate/query-perf-smoke";

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (typeof code === "number" && code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}\n${stderr}`));
        return;
      }
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} terminated with signal ${signal}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function ensureFixtureDirectory() {
  await fs.mkdir(fixturesDir, { recursive: true });
}

function datasetSuffix(rows) {
  if (rows >= 1000 && rows % 1000 === 0) {
    return `${rows / 1000}k`;
  }
  return `${rows}`;
}

async function generateFixture() {
  await ensureFixtureDirectory();
  const args = [
    "--loader",
    "ts-node/esm",
    "scripts/bench/generate_query_fixture.ts",
    "--rows",
    String(ROWS),
    "--seed",
    String(FIXTURE_SEED),
  ];
  console.log(`${JOB_LABEL}: generating ${ROWS.toLocaleString()}-row query fixture (seed ${FIXTURE_SEED})…`);
  await spawnCommand("node", args);
  const expectedPath = path.join(fixturesDir, `query-${datasetSuffix(ROWS)}.sqlite3`);
  try {
    await fs.stat(expectedPath);
  } catch (error) {
    throw new Error(`Expected query fixture at ${expectedPath} after generation`, { cause: error });
  }
  console.log(`${JOB_LABEL}: fixture ready at ${path.relative(repoRoot, expectedPath)}`);
}

async function runQueryBench() {
  const args = [
    "run",
    "--locked",
    "--bin",
    "time",
    "--",
    "query-bench",
    "--rows",
    String(ROWS),
    "--iterations",
    String(ITERATIONS),
    "--warmup",
    String(WARMUP),
    "--seed",
    String(SEED),
  ];

  for (const window of WINDOWS) {
    args.push("--window", window);
  }

  console.log(`${JOB_LABEL}: running query bench (iterations=${ITERATIONS}, warmup=${WARMUP}, seed=${SEED})…`);
  const { stdout } = await spawnCommand("cargo", args, { cwd: path.join(repoRoot, "src-tauri") });
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const jsonLine = lines.findLast((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error(`${JOB_LABEL}: expected JSON summary line from query bench output`);
  }
  let summary;
  try {
    summary = JSON.parse(jsonLine);
  } catch (error) {
    throw new Error(`${JOB_LABEL}: failed to parse JSON summary: ${error.message}`);
  }
  return summary;
}

function formatMs(value) {
  return value.toFixed(2).padStart(8, " ");
}

function formatCount(value) {
  return value.toFixed(1).padStart(8, " ");
}

function emitTable(summary) {
  console.log(`\n${JOB_LABEL}: window latency summary (milliseconds)`);
  console.log("Window    Min      P50      P95      Max   Trunc  Items(avg)");
  for (const window of summary.windows) {
    const row = [
      window.window.padEnd(8, " "),
      formatMs(window.min_ms),
      formatMs(window.p50_ms),
      formatMs(window.p95_ms),
      formatMs(window.max_ms),
      String(window.truncated).padStart(6, " "),
      formatCount(window.items_mean),
    ];
    console.log(row.join("  "));
  }
  console.log("");
}

function detectWarnings(summary) {
  const warnings = [];
  for (const window of summary.windows) {
    if (window.max_ms > THRESHOLD_MS) {
      warnings.push({
        window: window.window,
        maxMs: window.max_ms,
      });
    }
  }
  return warnings;
}

async function writeLog(summary, warnings) {
  await fs.mkdir(testResultsDir, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    job: JOB_LABEL,
    threshold_ms: THRESHOLD_MS,
    parameters: {
      rows: ROWS,
      iterations: ITERATIONS,
      warmup: WARMUP,
      seed: SEED,
      windows: WINDOWS,
      fixture_seed: FIXTURE_SEED,
    },
    dataset: {
      fixture: summary.fixture,
      working_copy: summary.working_copy,
      household: summary.household,
      requested_rows: summary.requested_rows,
      actual_rows: summary.actual_rows,
      recurrence_rows: summary.recurrence_rows,
      exdate_series: summary.exdate_series,
      dataset_span_ms: summary.dataset_span_ms,
      dataset_start_iso: summary.dataset_start_iso,
      dataset_end_iso: summary.dataset_end_iso,
    },
    windows: summary.windows.map((window) => ({
      window: window.window,
      duration_ms: window.duration_ms,
      iterations: window.iterations,
      warmup: window.warmup,
      min_ms: window.min_ms,
      p50_ms: window.p50_ms,
      p95_ms: window.p95_ms,
      max_ms: window.max_ms,
      mean_ms: window.mean_ms,
      truncated: window.truncated,
      items: {
        min: window.items_min,
        mean: window.items_mean,
        p95: window.items_p95,
        max: window.items_max,
      },
      start_ms: {
        min: window.start_min_ms,
        max: window.start_max_ms,
      },
      start_iso: {
        min: window.start_min_iso,
        max: window.start_max_iso,
      },
    })),
    warnings: warnings.map((warning) => ({
      window: warning.window,
      max_ms: warning.maxMs,
    })),
  };
  await fs.writeFile(logPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`${JOB_LABEL}: wrote timing log to ${path.relative(repoRoot, logPath)}`);
}

async function main() {
  try {
    await generateFixture();
    const summary = await runQueryBench();
    emitTable(summary);
    const warnings = detectWarnings(summary);
    if (warnings.length > 0) {
      for (const warning of warnings) {
        console.log(
          `::warning title=${JOB_LABEL}::${warning.window} window exceeded ${THRESHOLD_MS} ms threshold (max ${warning.maxMs.toFixed(
            2,
          )} ms)`,
        );
      }
      console.log(
        `${JOB_LABEL}: thresholds exceeded for ${warnings.length} window(s); job remains warning-only in this revision.`,
      );
    } else {
      console.log(`${JOB_LABEL}: all windows under ${THRESHOLD_MS} ms threshold.`);
    }
    await writeLog(summary, warnings);
  } catch (error) {
    console.error(`${JOB_LABEL}: failed`, error);
    process.exitCode = 1;
  }
}

await main();
