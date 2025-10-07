import test from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { validateFilename } from '../src/features/files/validation.ts';

type FixtureCase = {
  name?: string;
  nameRepeat?: [string, number];
  parent?: string;
  parentRepeat?: [string, number];
  parentSegmentsRepeat?: [string, number];
  valid: boolean;
  code?: string;
  normalized?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(
  __dirname,
  '../src-tauri/tests/fixtures/filename-validation.json',
);

const fixtureData = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureCase[];

const expand = (pattern: string, count: number): string => pattern.repeat(Math.max(count, 0));

const resolveName = (entry: FixtureCase): string => {
  if (typeof entry.name === 'string') return entry.name;
  if (entry.nameRepeat) {
    const [pattern, count] = entry.nameRepeat;
    return expand(pattern, count);
  }
  return '';
};

const resolveParent = (entry: FixtureCase): string | null => {
  if (typeof entry.parent === 'string') return entry.parent;
  if (entry.parentRepeat) {
    const [pattern, count] = entry.parentRepeat;
    return expand(pattern, count);
  }
  if (entry.parentSegmentsRepeat) {
    const [segment, count] = entry.parentSegmentsRepeat;
    if (count <= 0) return '';
    return new Array(count).fill(segment).join('/');
  }
  return '.';
};

test('validateFilename respects shared fixtures', () => {
  for (const entry of fixtureData) {
    const name = resolveName(entry);
    const parent = resolveParent(entry);
    const result = validateFilename(name, { parent });
    if (entry.valid) {
      assert.equal(result.ok, true, `expected ${name} to be valid`);
      if ('normalized' in entry && entry.normalized) {
        assert.equal(result.normalized, entry.normalized);
      }
    } else {
      assert.equal(result.ok, false, `expected ${name} to be rejected`);
      assert.equal(result.error.code, entry.code);
    }
  }
});

