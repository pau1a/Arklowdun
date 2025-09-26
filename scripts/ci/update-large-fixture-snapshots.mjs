#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
const expectedSummaryPath = path.join(repoRoot, 'fixtures', 'large', 'expected-summary.json');
const expectedAttachmentsPath = path.join(repoRoot, 'fixtures', 'large', 'expected-attachments.json');

function compareAttachmentRecords(a, b) {
  if (a.rootKey < b.rootKey) return -1;
  if (a.rootKey > b.rootKey) return 1;
  if (a.relativePath < b.relativePath) return -1;
  if (a.relativePath > b.relativePath) return 1;
  return 0;
}

async function hashFile(filePath) {
  return await new Promise((resolve, reject) => {
    const hasher = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hasher.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hasher.digest('hex')));
  });
}

async function collectAttachments(rootDir, rootKey, options = {}) {
  const { skip } = options;
  const items = [];

  async function walk(currentDir, relative) {
    let entries;
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const nextRel = relative ? path.join(relative, entry.name) : entry.name;
      if (skip && skip(nextRel, entry)) continue;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, nextRel);
      } else if (entry.isFile()) {
        const stat = await fsPromises.stat(absolute);
        const digest = await hashFile(absolute);
        items.push({
          rootKey,
          relativePath: nextRel.split(path.sep).join('/'),
          size: stat.size,
          sha256: digest,
        });
      }
    }
  }

  await walk(rootDir, '');
  items.sort(compareAttachmentRecords);
  return items;
}

async function runSeeder(dbPath, attachmentsDir, summaryPath) {
  await fsPromises.mkdir(path.dirname(summaryPath), { recursive: true });
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [
        '--loader',
        'ts-node/esm',
        'fixtures/large/seed.ts',
        '--db',
        dbPath,
        '--attachments',
        attachmentsDir,
        '--reset',
        '--seed',
        '42',
        '--summary',
        summaryPath,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Seeder exited with code ${code}`));
    });
  });
}

async function main() {
  const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'arklowdun-fixture-'));
  const dbPath = path.join(tmpRoot, 'arklowdun.sqlite3');
  const attachmentsDir = path.join(tmpRoot, 'attachments');
  const summaryPath = path.join(tmpRoot, 'summary.json');

  try {
    await runSeeder(dbPath, attachmentsDir, summaryPath);

    const summary = JSON.parse(await fsPromises.readFile(summaryPath, 'utf8'));
    // Keep this path consistent with docs; the verifier normalizes anyway.
    const summaryForSnapshot = { ...summary, database: '/tmp/roundtrip.sqlite3' };
    await fsPromises.writeFile(expectedSummaryPath, JSON.stringify(summaryForSnapshot, null, 2) + '\n');

    const attachments = [
      ...(await collectAttachments(attachmentsDir, 'attachments')),
      ...(await collectAttachments(path.dirname(dbPath), 'appData', {
        skip(relativePath) {
          if (relativePath === path.basename(attachmentsDir)) return true;
          if (relativePath === path.basename(dbPath)) return true;
          if (relativePath === path.basename(summaryPath)) return true;
          return false;
        },
      })),
    ];
    attachments.sort(compareAttachmentRecords);
    await fsPromises.writeFile(expectedAttachmentsPath, JSON.stringify(attachments, null, 2) + '\n');

    console.log('Updated golden snapshots:');
    console.log(' -', path.relative(repoRoot, expectedSummaryPath));
    console.log(' -', path.relative(repoRoot, expectedAttachmentsPath));
  } finally {
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});

