#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
const expectedSummaryPath = path.join(repoRoot, 'fixtures', 'large', 'expected-summary.json');
const expectedAttachmentsPath = path.join(repoRoot, 'fixtures', 'large', 'expected-attachments.json');

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeSummary(summary) {
  return {
    ...summary,
    database: '<normalized>',
  };
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

function compareAttachmentRecords(a, b) {
  if (a.rootKey !== b.rootKey) {
    return a.rootKey.localeCompare(b.rootKey);
  }
  return a.relativePath.localeCompare(b.relativePath);
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
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Large fixture seeder exited with code ${code}`));
      }
    });
  });
}

function reportDiff(expected, actual) {
  console.error('Expected value:');
  console.error(JSON.stringify(expected, null, 2));
  console.error('Actual value:');
  console.error(JSON.stringify(actual, null, 2));
}

async function main() {
  const keepTmp = process.env.KEEP_LARGE_FIXTURE_TMP === '1';
  const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'arklowdun-fixture-'));
  const dbPath = path.join(tmpRoot, 'arklowdun.sqlite3');
  const attachmentsDir = path.join(tmpRoot, 'attachments');
  const summaryPath = path.join(tmpRoot, 'summary.json');

  try {
    await runSeeder(dbPath, attachmentsDir, summaryPath);

    const [expectedSummaryRaw, actualSummaryRaw] = await Promise.all([
      fsPromises.readFile(expectedSummaryPath, 'utf8'),
      fsPromises.readFile(summaryPath, 'utf8'),
    ]);

    const expectedSummary = JSON.parse(expectedSummaryRaw);
    const actualSummary = JSON.parse(actualSummaryRaw);

    const normalizedExpected = normalizeSummary(expectedSummary);
    const normalizedActual = normalizeSummary(actualSummary);

    if (stableSerialize(normalizedActual) !== stableSerialize(normalizedExpected)) {
      console.error('Large fixture summary does not match golden snapshot.');
      reportDiff(normalizedExpected, normalizedActual);
      throw new Error('Summary mismatch');
    }

    const expectedAttachments = JSON.parse(await fsPromises.readFile(expectedAttachmentsPath, 'utf8'));
    expectedAttachments.sort(compareAttachmentRecords);

    const attachmentsActual = [
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

    attachmentsActual.sort(compareAttachmentRecords);

    if (stableSerialize(attachmentsActual) !== stableSerialize(expectedAttachments)) {
      console.error('Attachment corpus output does not match golden snapshot.');
      const firstMismatch = attachmentsActual.find((item, index) => {
        const expectedItem = expectedAttachments[index];
        return !expectedItem || stableSerialize(item) !== stableSerialize(expectedItem);
      });
      if (firstMismatch) {
        const index = attachmentsActual.indexOf(firstMismatch);
        console.error(`First mismatch at index ${index}`);
        console.error('Expected entry:', expectedAttachments[index]);
        console.error('Actual entry:', firstMismatch);
      } else if (attachmentsActual.length !== expectedAttachments.length) {
        console.error('Attachment list lengths differ.');
        console.error(`Expected ${expectedAttachments.length}, actual ${attachmentsActual.length}`);
      }
      throw new Error('Attachment mismatch');
    }

    console.log('Large fixture determinism check passed.');
  } finally {
    if (keepTmp) {
      console.log(`Preserving temporary directory: ${tmpRoot}`);
    } else {
      await fsPromises.rm(tmpRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
