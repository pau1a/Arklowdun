#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON="$ROOT/src/strings/en/recovery.json"

if [[ ! -f "$JSON" ]]; then
  echo "Missing recovery strings file: $JSON" >&2
  exit 1
fi

node - <<'NODE' "$ROOT" "$JSON"
const [root, jsonPath] = process.argv.slice(2);
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raw = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(raw);

function flatten(obj, prefix = '') {
  if (typeof obj === 'string') {
    return [prefix];
  }
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  return Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return flatten(value, next);
  });
}

const definedKeys = new Set(flatten(data));

const rg = spawnSync(
  'rg',
  [
    '--pcre2',
    '-o',
    '--no-line-number',
    '--no-filename',
    '--replace',
    '$1',
    'recoveryText\\(\\s*["\']([^"\']+)["\']',
    path.join(root, 'src'),
  ],
  { encoding: 'utf8' },
);

function fallbackScan(dir, results = new Set()) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fallbackScan(full, results);
    } else if (entry.isFile()) {
      if (!/\.(c|m)?(t|j)sx?$/.test(entry.name)) continue;
      const contents = fs.readFileSync(full, 'utf8');
      for (const match of contents.matchAll(/recoveryText\(\s*["']([^"']+)["']/g)) {
        results.add(match[1]);
      }
    }
  }
  return results;
}

let referenced;
if (rg.error && rg.error.code === 'ENOENT') {
  referenced = fallbackScan(path.join(root, 'src'));
} else {
  if (rg.status !== 0 && rg.status !== 1) {
    process.stderr.write(rg.stderr);
    process.exit(rg.status ?? 1);
  }
  referenced = new Set(
    rg.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

const missing = Array.from(referenced).filter((key) => !definedKeys.has(key));
if (missing.length) {
  console.error('Missing recovery strings for keys:');
  for (const key of missing) {
    console.error(` - ${key}`);
  }
  process.exit(1);
}
NODE
