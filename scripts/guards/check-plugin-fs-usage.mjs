#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

// Resolve all allowlists to absolute paths
const allowedDirs = [
  path.join(SRC_DIR, 'fs'),
  path.join(SRC_DIR, 'files'),
].map((p) => path.resolve(p));

const allowedFiles = [path.join(SRC_DIR, 'storage.ts')].map((p) => path.resolve(p));

const CODE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;
const TARGET = '@tauri-apps/plugin-fs';

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile() && CODE_EXT_RE.test(entry.name)) {
      files.push(path.resolve(fullPath));
    }
  }
  return files;
}

function isAllowed(file) {
  const f = path.resolve(file);
  if (allowedFiles.includes(f)) return true;
  return allowedDirs.some((d) => f.startsWith(d + path.sep));
}

(async () => {
  const files = await walk(SRC_DIR).catch((e) => {
    console.error(`Failed to scan src/: ${e?.message || e}`);
    process.exit(2);
  });
  const violations = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8').catch(() => '');
    if (content.includes(TARGET) && !isAllowed(file)) {
      violations.push(path.relative(REPO_ROOT, file));
    }
  }
  if (violations.length) {
    console.error('Forbidden @tauri-apps/plugin-fs usage in:');
    for (const v of violations) {
      console.error(' - ' + v);
    }
    process.exit(1);
  } else {
    console.log('check-plugin-fs-usage: OK');
  }
})();
