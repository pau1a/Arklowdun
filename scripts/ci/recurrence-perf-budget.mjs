#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const totalLimit = Number(process.env.RECURRENCE_TOTAL_LIMIT ?? process.env.EVENTS_LIST_RANGE_TOTAL_LIMIT ?? '10000');
const seriesThreshold = Number(
  process.env.RECURRENCE_SERIES_THRESHOLD_MS ?? Math.max(750, Math.round(totalLimit * 0.12)),
);
const queryThreshold = Number(
  process.env.RECURRENCE_QUERY_THRESHOLD_MS ?? Math.max(2500, Math.round(totalLimit * 0.35)),
);
const rssDeltaThreshold = Number(
  process.env.RECURRENCE_RSS_DELTA_KB ?? Math.max(50000, Math.round(totalLimit * 8)),
);
const runs = Number(process.env.RECURRENCE_BENCH_RUNS ?? '3');

const cargoArgs = [
  'run',
  '--locked',
  '--bin',
  'recurrence_bench',
  '--',
  '--scenario',
  'all',
  '--runs',
  String(runs),
];

const child = spawn('cargo', cargoArgs, { cwd: 'src-tauri', stdio: ['ignore', 'pipe', 'inherit'] });

let stdout = '';
child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});

child.on('close', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }
  try {
    evaluate(stdout);
  } catch (error) {
    console.error('recurrence perf budget failed', error);
    process.exit(1);
  }
});

function evaluate(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = lines
    .filter((line) => !line.startsWith('scenario,'))
    .map(parseRow);

  const summary = {
    thresholds: {
      series_ms: seriesThreshold,
      query_ms: queryThreshold,
      rss_delta_kb: rssDeltaThreshold,
      total_limit: totalLimit,
    },
    samples: rows,
    failures: [],
  };

  const seriesRuns = rows.filter((row) => row.scenario === 'Series');
  const queryRuns = rows.filter((row) => row.scenario === 'Query');

  if (seriesRuns.length === 0 || queryRuns.length === 0) {
    throw new Error(
      `recurrence bench output missing scenarios: series=${seriesRuns.length} query=${queryRuns.length}`,
    );
  }

  const seriesMax = Math.max(...seriesRuns.map((row) => row.elapsed_ms));
  const queryMax = Math.max(...queryRuns.map((row) => row.elapsed_ms));
  const memoryMax = Math.max(...rows.map((row) => row.rss_delta_kb));

  if (seriesMax > seriesThreshold) {
    summary.failures.push({
      kind: 'series_time',
      observed_ms: seriesMax,
      threshold_ms: seriesThreshold,
    });
  }
  if (queryMax > queryThreshold) {
    summary.failures.push({
      kind: 'query_time',
      observed_ms: queryMax,
      threshold_ms: queryThreshold,
    });
  }
  if (memoryMax > rssDeltaThreshold) {
    summary.failures.push({
      kind: 'rss_delta',
      observed_kb: memoryMax,
      threshold_kb: rssDeltaThreshold,
    });
  }

  mkdirSync('test-results', { recursive: true });
  writeFileSync(join('test-results', 'recurrence-perf-budget.json'), JSON.stringify(summary, null, 2));

  if (summary.failures.length > 0) {
    for (const failure of summary.failures) {
      switch (failure.kind) {
        case 'series_time':
          console.error(
            `Series benchmark exceeded threshold: ${failure.observed_ms.toFixed(2)}ms > ${failure.threshold_ms}ms`,
          );
          break;
        case 'query_time':
          console.error(
            `Query benchmark exceeded threshold: ${failure.observed_ms.toFixed(2)}ms > ${failure.threshold_ms}ms`,
          );
          break;
        case 'rss_delta':
          console.error(
            `RSS delta exceeded threshold: ${failure.observed_kb}KB > ${failure.threshold_kb}KB`,
          );
          break;
        default:
          console.error('Unexpected failure entry', failure);
      }
    }
    process.exit(1);
  }
}

function parseRow(line) {
  const [scenario, run, expanded, truncated, elapsed, rss, rssDelta, hwm] = line.split(',');
  return {
    scenario,
    run: Number(run),
    expanded: Number(expanded),
    truncated: truncated === 'true' || truncated === '1',
    elapsed_ms: Number(elapsed),
    rss_kb: Number(rss),
    rss_delta_kb: Number(rssDelta),
    hwm_kb: Number(hwm),
  };
}
