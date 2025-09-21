#!/usr/bin/env node

process.env.QUERY_PERF_ROWS ||= '1000';
process.env.QUERY_PERF_ITERATIONS ||= '10';
process.env.QUERY_PERF_WARMUP ||= '2';
process.env.QUERY_PERF_WINDOWS ||= 'day,week,month';

await import('./query-perf-smoke.mjs');
