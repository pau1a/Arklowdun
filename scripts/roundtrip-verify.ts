import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import process from 'node:process';
import Database from 'better-sqlite3';

interface CliOptions {
  beforeDir: string;
  afterDir: string;
  tables: string[];
  sampleSize: number;
  outPath: string;
  failOn: Set<FailureCategory>;
  strict: boolean;
  includeDeleted: boolean;
  caseFoldPaths: boolean;
}

type FailureCategory = 'counts' | 'rows' | 'attachments' | 'health';

const REPORT_VERSION = 1 as const;
const DEFAULT_SAMPLE_SIZE = 16;
const DEFAULT_FAIL_ON: FailureCategory[] = ['counts', 'attachments', 'health'];
const DIFF_PREVIEW_LIMIT = 5;

type SortValue =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string };

type NormalizedValue =
  | string
  | number
  | boolean
  | null
  | NormalizedValue[]
  | { [key: string]: NormalizedValue };

type NormalizedObject = { [key: string]: NormalizedValue };

interface RowSnapshot {
  normalized?: NormalizedObject;
  hash: string;
  sortValue: SortValue;
}

interface TableSnapshot {
  count: number;
  rows?: Map<string, RowSnapshot>;
  tableHash: string;
}

interface TableConfig {
  logicalName: string;
  fileName: string;
  tableName: string;
  idColumn: string;
  idType: 'string' | 'number';
  orderBy?: string;
  filterDeleted?: boolean;
  excludeColumns?: string[];
  normalizer?: (row: Record<string, unknown>) => Record<string, unknown>;
}

interface TableDiffResult {
  counts: CountComparison;
  table_hash: HashComparison;
  row_diffs: RowDiffs;
}

interface CountComparison {
  before: number;
  after: number;
  ok: boolean;
}

interface HashComparison {
  before: string;
  after: string;
  ok: boolean;
}

interface RowDiffs {
  missing_ids: string[];
  extra_ids: string[];
  mismatched: RowMismatch[];
}

interface RowMismatch {
  id: string;
  before_hash: string;
  after_hash: string;
  changed_keys: string[];
}

interface AttachmentRecord {
  relativePath: string;
  normalizedPath: string;
  size: number;
  sha256: string;
}

interface AttachmentDiffResult {
  counts: CountComparison;
  bytes: CountComparison;
  sha_mismatches: AttachmentMismatch[];
  sample_verified: number;
  sample_mismatches: AttachmentSampleMismatch[];
}

interface AttachmentMismatch {
  path: string;
  before_sha: string | null;
  after_sha: string | null;
  before_size?: number | null;
  after_size?: number | null;
}

interface AttachmentSampleMismatch {
  path: string;
  reason: string;
}

interface HealthCheckSummary {
  name: string;
  ok: boolean;
  details?: string;
}

interface HealthReportSummary {
  ok: boolean;
  checks: HealthCheckSummary[];
}

const TABLES: Record<string, TableConfig> = {
  households: {
    logicalName: 'households',
    fileName: 'households.jsonl',
    tableName: 'household',
    idColumn: 'id',
    idType: 'string',
    orderBy: 'id',
    filterDeleted: true,
    excludeColumns: ['updated_at', 'last_viewed_at'],
  },
  events: {
    logicalName: 'events',
    fileName: 'events.jsonl',
    tableName: 'events',
    idColumn: 'id',
    idType: 'string',
    orderBy: 'id',
    filterDeleted: true,
    excludeColumns: ['updated_at', 'last_viewed_at'],
  },
  notes: {
    logicalName: 'notes',
    fileName: 'notes.jsonl',
    tableName: 'notes',
    idColumn: 'id',
    idType: 'string',
    orderBy: 'id',
    filterDeleted: true,
    excludeColumns: ['updated_at', 'last_viewed_at'],
  },
  files: {
    logicalName: 'files',
    fileName: 'files.jsonl',
    tableName: 'files_index',
    idColumn: 'id',
    idType: 'number',
    orderBy: 'id',
    excludeColumns: ['updated_at_utc', 'last_viewed_at'],
  },
};

function usage(): never {
  const available = Object.keys(TABLES).sort().join(', ');
  console.error(
    `Usage: scripts/roundtrip-verify.ts --before <export-dir> --after <appdata-dir> [options]\n\n` +
      `Options:\n` +
      `  --tables <csv|all>        Tables to verify (default: all = ${available})\n` +
      `  --include-deleted         Include soft-deleted rows when diffing (default: false)\n` +
      `  --sample <n>              Attachment byte-compare sample size (default: ${DEFAULT_SAMPLE_SIZE})\n` +
      '  --case-fold-paths         Case-fold attachment paths before comparing\n' +
      '  --no-case-fold-paths      Force case-sensitive attachment comparisons\n' +
      '  --out <path>              Output diff report path (default: roundtrip-diff.json)\n' +
      '  --fail-on <set>           Failure categories (counts,rows,attachments,health,any)\n' +
      '  --strict                  Treat any row mismatch as failure\n' +
      '  --help                    Show this message\n',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    includeDeleted: false,
    caseFoldPaths: process.platform === 'win32',
  };
  let failOnArg: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--before': {
        const value = argv[++i];
        if (!value) usage();
        options.beforeDir = value;
        break;
      }
      case '--after': {
        const value = argv[++i];
        if (!value) usage();
        options.afterDir = value;
        break;
      }
      case '--tables': {
        const value = argv[++i];
        if (!value) usage();
        if (value === 'all') {
          options.tables = Object.keys(TABLES);
        } else {
          options.tables = value.split(',').map((t) => t.trim()).filter(Boolean);
        }
        break;
      }
      case '--include-deleted': {
        options.includeDeleted = true;
        break;
      }
      case '--sample': {
        const value = argv[++i];
        if (!value) usage();
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`invalid --sample value: ${value}`);
        }
        options.sampleSize = parsed;
        break;
      }
      case '--case-fold-paths': {
        options.caseFoldPaths = true;
        break;
      }
      case '--no-case-fold-paths': {
        options.caseFoldPaths = false;
        break;
      }
      case '--out': {
        const value = argv[++i];
        if (!value) usage();
        options.outPath = value;
        break;
      }
      case '--fail-on': {
        const value = argv[++i];
        if (!value) usage();
        failOnArg = value;
        break;
      }
      case '--strict': {
        options.strict = true;
        break;
      }
      case '--help':
        usage();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.beforeDir || !options.afterDir) {
    usage();
  }

  const defaultTables = Object.keys(TABLES);
  const tables = options.tables ?? defaultTables;
  const invalid = tables.filter((t) => !TABLES[t]);
  if (invalid.length > 0) {
    throw new Error(`Unknown table(s) requested: ${invalid.join(', ')}`);
  }

  const failOn = parseFailOn(failOnArg);

  return {
    beforeDir: path.resolve(options.beforeDir!),
    afterDir: path.resolve(options.afterDir!),
    tables,
    sampleSize: options.sampleSize ?? DEFAULT_SAMPLE_SIZE,
    outPath: path.resolve(options.outPath ?? 'roundtrip-diff.json'),
    failOn,
    strict: options.strict ?? false,
    includeDeleted: options.includeDeleted ?? false,
    caseFoldPaths: options.caseFoldPaths ?? false,
  };
}

function parseFailOn(value: string | undefined): Set<FailureCategory> {
  const categories: FailureCategory[] = ['counts', 'rows', 'attachments', 'health'];
  if (!value) {
    return new Set<FailureCategory>(DEFAULT_FAIL_ON);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'any') {
    return new Set(categories);
  }

  const selected = new Set<FailureCategory>();
  for (const part of normalized.split(',')) {
    const key = part.trim();
    if (!key) continue;
    if (!categories.includes(key as FailureCategory)) {
      throw new Error(`Unknown --fail-on category: ${key}`);
    }
    selected.add(key as FailureCategory);
  }
  if (selected.size === 0) {
    throw new Error('No valid --fail-on categories provided');
  }
  return selected;
}

function normalizeString(value: string): string {
  return value.normalize('NFC').trim();
}

function normalizeValue(input: unknown): NormalizedValue {
  if (input === null) return null;
  if (typeof input === 'string') {
    return normalizeString(input);
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : normalizeString(String(input));
  }
  if (typeof input === 'boolean') {
    return input;
  }
  if (typeof input === 'bigint') {
    return normalizeString(input.toString());
  }
  if (Array.isArray(input)) {
    return input.map((item) => normalizeValue(item));
  }
  if (Buffer.isBuffer(input)) {
    return normalizeString(input.toString('base64'));
  }
  if (input instanceof Date) {
    return normalizeString(input.toISOString());
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const normalized: { [key: string]: NormalizedValue } = {};
    for (const key of keys) {
      const value = obj[key];
      if (value === undefined) continue;
      normalized[key] = normalizeValue(value);
    }
    return normalized;
  }
  return normalizeString(String(input));
}

function normalizeRow(row: Record<string, unknown>, exclude: Set<string>): NormalizedObject {
  const normalized: NormalizedObject = {};
  const keys = Object.keys(row).sort();
  for (const key of keys) {
    if (exclude.has(key)) continue;
    const value = row[key];
    if (value === undefined) continue;
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

function stableStringify(value: NormalizedValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, NormalizedValue>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

function hashNormalized(normalized: NormalizedObject): string {
  const hasher = createHash('sha256');
  hasher.update(stableStringify(normalized));
  return hasher.digest('hex');
}

function toSortValue(raw: unknown, expected: 'string' | 'number'): SortValue {
  if (expected === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) {
      throw new Error(`Expected numeric identifier, received ${raw}`);
    }
    return { kind: 'number', value: num };
  }
  return { kind: 'string', value: String(raw) };
}

function compareSortValue(a: SortValue, b: SortValue): number {
  if (a.kind === 'number' && b.kind === 'number') {
    return a.value - b.value;
  }
  const aStr = a.kind === 'number' ? a.value.toString() : a.value;
  const bStr = b.kind === 'number' ? b.value.toString() : b.value;
  return aStr.localeCompare(bStr);
}

function prepareRowSnapshot(
  row: Record<string, unknown>,
  config: TableConfig,
  includeNormalized: boolean,
): [string, RowSnapshot] {
  const idValue = row[config.idColumn];
  if (idValue === undefined || idValue === null) {
    throw new Error(`Row missing primary key column '${config.idColumn}' in table ${config.logicalName}`);
  }
  const key = String(idValue);
  const sortValue = toSortValue(idValue, config.idType);
  const exclude = new Set(config.excludeColumns ?? []);
  const baseRow = config.normalizer ? config.normalizer({ ...row }) : row;
  const normalized = normalizeRow(baseRow, exclude);
  const hash = hashNormalized(normalized);
  const snapshot: RowSnapshot = { hash, sortValue };
  if (includeNormalized) {
    snapshot.normalized = normalized;
  }
  return [key, snapshot];
}

async function collectJsonlTable(
  filePath: string,
  config: TableConfig,
  needRows: boolean,
): Promise<TableSnapshot> {
  await ensureFileExists(filePath, `Data file missing for table ${config.logicalName}`);
  const rows = needRows ? new Map<string, RowSnapshot>() : undefined;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  const hasher = createHash('sha256');
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const [key, snapshot] = prepareRowSnapshot(parsed, config, Boolean(rows));
    if (rows) {
      rows.set(key, snapshot);
    }
    hasher.update(snapshot.hash);
    hasher.update('\n');
    count += 1;
  }
  rl.close();
  const tableHash = hasher.digest('hex');
  return { count, rows, tableHash };
}

function collectDatabaseTable(
  db: Database.Database,
  config: TableConfig,
  includeDeleted: boolean,
  needRows: boolean,
): TableSnapshot {
  const order = config.orderBy ?? config.idColumn;
  const filterDeleted = config.filterDeleted && !includeDeleted;
  const whereClause = filterDeleted ? 'WHERE deleted_at IS NULL' : '';
  const sql = `SELECT * FROM ${config.tableName} ${whereClause} ORDER BY ${order}`;
  const stmt = db.prepare(sql);
  const rows = needRows ? new Map<string, RowSnapshot>() : undefined;
  let count = 0;
  const hasher = createHash('sha256');
  for (const record of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
    const [key, snapshot] = prepareRowSnapshot(record, config, Boolean(rows));
    if (rows) {
      rows.set(key, snapshot);
    }
    hasher.update(snapshot.hash);
    hasher.update('\n');
    count += 1;
  }
  const tableHash = hasher.digest('hex');
  return { count, rows, tableHash };
}

function diffNormalizedRows(before: NormalizedObject, after: NormalizedObject): string[] {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const left = before[key];
    const right = after[key];
    if (!deepEqualNormalized(left, right)) {
      changed.push(key);
    }
  }
  changed.sort();
  return changed;
}

function deepEqualNormalized(a: NormalizedValue | undefined, b: NormalizedValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') {
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualNormalized(a[i], b[i])) return false;
    }
    return true;
  }
  if (!Array.isArray(a) && !Array.isArray(b)) {
    const aObj = a as Record<string, NormalizedValue>;
    const bObj = b as Record<string, NormalizedValue>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i += 1) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!deepEqualNormalized(aObj[aKeys[i]], bObj[bKeys[i]])) return false;
    }
    return true;
  }
  return false;
}

function sortKeysBySnapshot(keys: string[], rows: Map<string, RowSnapshot>): string[] {
  const annotated = keys.map((key) => {
    const snapshot = rows.get(key);
    if (!snapshot) {
      return { key, sortValue: { kind: 'string', value: key } as SortValue };
    }
    return { key, sortValue: snapshot.sortValue };
  });
  annotated.sort((a, b) => {
    const cmp = compareSortValue(a.sortValue, b.sortValue);
    if (cmp !== 0) return cmp;
    return a.key.localeCompare(b.key);
  });
  return annotated.map((item) => item.key);
}

function diffTables(before: TableSnapshot, after: TableSnapshot): TableDiffResult {
  const counts: CountComparison = {
    before: before.count,
    after: after.count,
    ok: before.count === after.count,
  };
  const tableHash: HashComparison = {
    before: before.tableHash,
    after: after.tableHash,
    ok: before.tableHash === after.tableHash,
  };

  if (!before.rows || !after.rows) {
    return {
      counts,
      table_hash: tableHash,
      row_diffs: { missing_ids: [], extra_ids: [], mismatched: [] },
    };
  }

  const missing: string[] = [];
  const extra: string[] = [];
  const mismatched: RowMismatch[] = [];

  for (const [key, beforeRow] of before.rows.entries()) {
    const afterRow = after.rows.get(key);
    if (!afterRow) {
      missing.push(key);
      continue;
    }
    if (beforeRow.hash !== afterRow.hash) {
      const changedKeys =
        beforeRow.normalized && afterRow.normalized
          ? diffNormalizedRows(beforeRow.normalized, afterRow.normalized)
          : [];
      mismatched.push({ id: key, before_hash: beforeRow.hash, after_hash: afterRow.hash, changed_keys: changedKeys });
    }
  }

  for (const key of after.rows.keys()) {
    if (!before.rows.has(key)) {
      extra.push(key);
    }
  }

  const missingSorted = sortKeysBySnapshot(missing, before.rows);
  const extraSorted = sortKeysBySnapshot(extra, after.rows);
  mismatched.sort((a, b) => a.id.localeCompare(b.id));

  return {
    counts,
    table_hash: tableHash,
    row_diffs: {
      missing_ids: missingSorted,
      extra_ids: extraSorted,
      mismatched,
    },
  };
}

function logDiffPreview(table: string, diff: TableDiffResult, limit: number): void {
  const { missing_ids: missing, extra_ids: extra, mismatched } = diff.row_diffs;
  if (missing.length > 0) {
    const preview = missing.slice(0, limit);
    const suffix = missing.length > limit ? '…' : '';
    console.log(`[roundtrip-verify] ${table}: missing ${preview.join(', ')}${suffix}`);
  }
  if (extra.length > 0) {
    const preview = extra.slice(0, limit);
    const suffix = extra.length > limit ? '…' : '';
    console.log(`[roundtrip-verify] ${table}: extra ${preview.join(', ')}${suffix}`);
  }
  if (mismatched.length > 0) {
    const preview = mismatched.slice(0, limit).map((item) => item.id);
    const suffix = mismatched.length > limit ? '…' : '';
    console.log(`[roundtrip-verify] ${table}: mismatched ${preview.join(', ')}${suffix}`);
  }
}

async function ensureFileExists(filePath: string, message: string): Promise<void> {
  try {
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(message);
    }
  } catch (error) {
    throw new Error(`${message}: ${(error as Error).message}`);
  }
}

async function ensureDirectory(pathname: string, message: string): Promise<void> {
  try {
    const stat = await fsPromises.stat(pathname);
    if (!stat.isDirectory()) {
      throw new Error(message);
    }
  } catch (error) {
    throw new Error(`${message}: ${(error as Error).message}`);
  }
}

function normalizeAttachmentKey(relativePath: string, caseFold: boolean): string {
  const normalized = relativePath.split(path.sep).join('/').normalize('NFC');
  return caseFold ? normalized.toLocaleLowerCase('en-US') : normalized;
}

async function computeFileSha256(filePath: string): Promise<string> {
  const hasher = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hasher.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hasher.digest('hex');
}

async function collectAttachments(root: string, caseFold: boolean): Promise<Map<string, AttachmentRecord>> {
  const records = new Map<string, AttachmentRecord>();
  let rootStat: fs.Stats;
  try {
    rootStat = await fsPromises.stat(root);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === 'ENOENT') {
      return records;
    }
    throw new Error(`Unable to read attachments directory '${root}': ${err?.message ?? error}`);
  }
  if (!rootStat.isDirectory()) {
    return records;
  }

  async function walk(currentDir: string, relative: string): Promise<void> {
    const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative);
      } else if (entry.isFile()) {
        const stat = await fsPromises.stat(absolute);
        const sha = await computeFileSha256(absolute);
        const normalizedPath = normalizeAttachmentKey(nextRelative, caseFold);
        if (records.has(normalizedPath)) {
          continue;
        }
        records.set(normalizedPath, {
          relativePath: nextRelative.split(path.sep).join('/'),
          normalizedPath,
          size: stat.size,
          sha256: sha,
        });
      }
    }
  }

  await walk(root, '');
  return records;
}

function sumAttachmentSizes(records: Map<string, AttachmentRecord>): number {
  let total = 0;
  for (const record of records.values()) {
    total += record.size;
  }
  return total;
}

function resolveAttachmentPath(root: string, relative: string): string {
  if (!relative) return root;
  return path.join(root, ...relative.split('/'));
}

async function diffAttachments(
  beforeRoot: string,
  afterRoot: string,
  sampleSize: number,
  caseFold: boolean,
): Promise<AttachmentDiffResult> {
  const beforeMap = await collectAttachments(beforeRoot, caseFold);
  const afterMap = await collectAttachments(afterRoot, caseFold);

  const counts: CountComparison = {
    before: beforeMap.size,
    after: afterMap.size,
    ok: beforeMap.size === afterMap.size,
  };

  const beforeBytes = sumAttachmentSizes(beforeMap);
  const afterBytes = sumAttachmentSizes(afterMap);
  const bytes: CountComparison = {
    before: beforeBytes,
    after: afterBytes,
    ok: beforeBytes === afterBytes,
  };

  const allKeys = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
  const shaMismatches: AttachmentMismatch[] = [];
  for (const key of Array.from(allKeys).sort()) {
    const beforeRecord = beforeMap.get(key);
    const afterRecord = afterMap.get(key);
    if (!beforeRecord || !afterRecord || beforeRecord.sha256 !== afterRecord.sha256) {
      shaMismatches.push({
        path: beforeRecord?.relativePath ?? afterRecord?.relativePath ?? key,
        before_sha: beforeRecord?.sha256 ?? null,
        after_sha: afterRecord?.sha256 ?? null,
        before_size: beforeRecord?.size ?? null,
        after_size: afterRecord?.size ?? null,
      });
    }
  }

  const intersection = [...beforeMap.keys()].filter((key) => afterMap.has(key));
  const sampleCandidates = intersection
    .map((key) => ({ key, digest: createHash('sha256').update(key).digest('hex') }))
    .sort((a, b) => a.digest.localeCompare(b.digest))
    .slice(0, Math.min(sampleSize, intersection.length));

  const sampleMismatches: AttachmentSampleMismatch[] = [];
  for (const candidate of sampleCandidates) {
    const beforeRecord = beforeMap.get(candidate.key);
    const afterRecord = afterMap.get(candidate.key);
    if (!beforeRecord || !afterRecord) continue;
    try {
      const beforePath = resolveAttachmentPath(beforeRoot, beforeRecord.relativePath);
      const afterPath = resolveAttachmentPath(afterRoot, afterRecord.relativePath);
      const [beforeBuffer, afterBuffer] = await Promise.all([
        fsPromises.readFile(beforePath),
        fsPromises.readFile(afterPath),
      ]);
      if (beforeBuffer.length !== afterBuffer.length || !beforeBuffer.equals(afterBuffer)) {
        sampleMismatches.push({
          path: beforeRecord.relativePath,
          reason: 'byte mismatch',
        });
      }
    } catch (error) {
      sampleMismatches.push({
        path: beforeRecord.relativePath,
        reason: (error as Error).message,
      });
    }
  }

  return {
    counts,
    bytes,
    sha_mismatches: shaMismatches,
    sample_verified: sampleCandidates.length,
    sample_mismatches: sampleMismatches,
  };
}

async function runHealthChecks(
  db: Database.Database,
  dbPath: string,
  strictStorage: boolean,
): Promise<HealthReportSummary> {
  const checks: HealthCheckSummary[] = [];
  checks.push(runQuickCheck(db));
  checks.push(runIntegrityCheck(db));
  checks.push(runForeignKeyCheck(db));
  checks.push(await runStorageSanity(db, dbPath, strictStorage));
  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function runQuickCheck(db: Database.Database): HealthCheckSummary {
  try {
    const row = db.prepare('PRAGMA quick_check;').get() as { quick_check?: string } | undefined;
    const result = (row?.quick_check ?? '').toString();
    const ok = result.length === 0 || result.toLowerCase() === 'ok';
    return {
      name: 'quick_check',
      ok,
      details: ok ? undefined : result,
    };
  } catch (error) {
    return {
      name: 'quick_check',
      ok: false,
      details: (error as Error).message,
    };
  }
}

function runIntegrityCheck(db: Database.Database): HealthCheckSummary {
  try {
    const row = db.prepare('PRAGMA integrity_check(1);').get() as { integrity_check?: string } | undefined;
    const result = (row?.integrity_check ?? '').toString();
    const ok = result.length === 0 || result.toLowerCase() === 'ok';
    return {
      name: 'integrity_check',
      ok,
      details: ok ? undefined : result,
    };
  } catch (error) {
    return {
      name: 'integrity_check',
      ok: false,
      details: (error as Error).message,
    };
  }
}

function runForeignKeyCheck(db: Database.Database): HealthCheckSummary {
  try {
    const rows = db.prepare('PRAGMA foreign_key_check;').all() as Record<string, unknown>[];
    const violations = rows.length;
    return {
      name: 'foreign_key_check',
      ok: violations === 0,
      details: violations === 0 ? undefined : `${violations} violation(s)`,
    };
  } catch (error) {
    return {
      name: 'foreign_key_check',
      ok: false,
      details: (error as Error).message,
    };
  }
}

async function runStorageSanity(
  db: Database.Database,
  dbPath: string,
  strictStorage: boolean,
): Promise<HealthCheckSummary> {
  const details: string[] = [];
  const warnings: string[] = [];
  let ok = true;

  try {
    const row = db.prepare('PRAGMA journal_mode;').get() as { journal_mode?: string } | undefined;
    const mode = row?.journal_mode;
    if (typeof mode === 'string') {
      details.push(`journal_mode=${mode}`);
      if (mode.toLowerCase() !== 'wal') {
        if (strictStorage) {
          ok = false;
        } else {
          warnings.push(`journal_mode=${mode}`);
        }
      }
    } else {
      ok = false;
      details.push('journal_mode unavailable');
    }
  } catch (error) {
    ok = false;
    details.push(`journal_mode error: ${(error as Error).message}`);
  }

  let pageSize: number | null = null;
  try {
    const row = db.prepare('PRAGMA page_size;').get() as { page_size?: number } | undefined;
    const size = row?.page_size;
    if (typeof size === 'number') {
      pageSize = size;
      details.push(`page_size=${size}`);
      if (size !== 4096) {
        if (strictStorage) {
          ok = false;
        } else {
          warnings.push(`page_size=${size}`);
        }
      }
    } else {
      ok = false;
      details.push('page_size unavailable');
    }
  } catch (error) {
    ok = false;
    details.push(`page_size error: ${(error as Error).message}`);
  }

  if (pageSize !== null) {
    const wal = await inspectWalFile(dbPath, pageSize);
    if (!wal.ok) {
      ok = false;
    }
    details.push(wal.details);
  }

  const detailParts = [...details];
  if (warnings.length > 0) {
    detailParts.push(`warnings=${warnings.join(',')}`);
  }

  return {
    name: 'storage_sanity',
    ok,
    details: detailParts.join('; '),
  };
}

async function inspectWalFile(dbPath: string, pageSize: number): Promise<{ ok: boolean; details: string }> {
  const walPath = `${dbPath}-wal`;
  let stat: fs.Stats;
  try {
    stat = await fsPromises.stat(walPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === 'ENOENT') {
      return { ok: true, details: 'wal=absent' };
    }
    return { ok: false, details: `wal stat error: ${err?.message ?? error}` };
  }

  if (!stat.isFile()) {
    return { ok: false, details: 'wal is not a regular file' };
  }

  const size = stat.size;
  if (size === 0) {
    return { ok: true, details: 'wal=empty' };
  }
  if (size < 32) {
    return { ok: false, details: `wal too small (${size} bytes)` };
  }

  const handle = await fsPromises.open(walPath, 'r');
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    const expected = Buffer.from('WAL\0');
    if (!header.equals(expected)) {
      return { ok: false, details: 'wal header mismatch' };
    }
  } finally {
    await handle.close();
  }

  if ((size - 32) % pageSize !== 0) {
    return { ok: false, details: `wal size misaligned (${size} bytes, page_size=${pageSize})` };
  }

  return { ok: true, details: `wal=${size} bytes` };
}

async function resolveBeforePaths(beforeDir: string): Promise<{
  exportDir: string;
  dataDir: string;
  attachmentsDir: string;
}> {
  const exportDir = path.resolve(beforeDir);
  await ensureDirectory(exportDir, 'Before export directory not found');
  const dataDir = path.join(exportDir, 'data');
  await ensureDirectory(dataDir, 'Export data directory (data/) not found');
  const attachmentsDir = path.join(exportDir, 'attachments');
  return { exportDir, dataDir, attachmentsDir };
}

async function resolveAfterPaths(afterPath: string): Promise<{
  appDataDir: string;
  dbPath: string;
  attachmentsDir: string;
}> {
  const resolved = path.resolve(afterPath);
  const stat = await fsPromises.stat(resolved);
  let appDataDir: string;
  let dbPath: string;
  if (stat.isDirectory()) {
    appDataDir = resolved;
    dbPath = path.join(appDataDir, 'arklowdun.sqlite3');
  } else {
    appDataDir = path.dirname(resolved);
    dbPath = resolved;
  }
  await ensureFileExists(dbPath, 'Imported database file not found');
  const attachmentsDir = path.join(appDataDir, 'attachments');
  return { appDataDir, dbPath, attachmentsDir };
}

function buildMeta(
  options: CliOptions,
  before: { exportDir: string; dataDir: string; attachmentsDir: string },
  after: { appDataDir: string; dbPath: string; attachmentsDir: string },
): Record<string, unknown> {
  return {
    version: REPORT_VERSION,
    generated_at: new Date().toISOString(),
    before: before.exportDir,
    before_data_dir: before.dataDir,
    before_attachments_dir: before.attachmentsDir,
    after: after.appDataDir,
    after_db: after.dbPath,
    after_attachments_dir: after.attachmentsDir,
    options: {
      tables: options.tables,
      sample: options.sampleSize,
      strict: options.strict,
      fail_on: Array.from(options.failOn).sort(),
      include_deleted: options.includeDeleted,
      case_fold_paths: options.caseFoldPaths,
    },
  };
}

async function writeReport(outPath: string, payload: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
  await fsPromises.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const beforePaths = await resolveBeforePaths(options.beforeDir);
  const afterPaths = await resolveAfterPaths(options.afterDir);

  const db = new Database(afterPaths.dbPath, { readonly: true, fileMustExist: true });
  const tables: Record<string, TableDiffResult> = {};
  const countFailures: string[] = [];
  const rowFailures: string[] = [];
  const initialRowDetail = options.strict || options.failOn.has('rows');

  try {
    for (const tableName of options.tables) {
      const config = TABLES[tableName];
      const beforeFile = path.join(beforePaths.dataDir, config.fileName);
      let beforeSnapshot = await collectJsonlTable(beforeFile, config, initialRowDetail);
      let afterSnapshot = collectDatabaseTable(db, config, options.includeDeleted, initialRowDetail);
      let diff = diffTables(beforeSnapshot, afterSnapshot);
      const needsDetailPass =
        !initialRowDetail && (!diff.counts.ok || !diff.table_hash.ok);
      if (needsDetailPass) {
        beforeSnapshot = await collectJsonlTable(beforeFile, config, true);
        afterSnapshot = collectDatabaseTable(db, config, options.includeDeleted, true);
        diff = diffTables(beforeSnapshot, afterSnapshot);
      }
      tables[tableName] = diff;
      if (!diff.counts.ok) {
        countFailures.push(tableName);
      }
      const rowDiffExists =
        !diff.table_hash.ok ||
        diff.row_diffs.missing_ids.length > 0 ||
        diff.row_diffs.extra_ids.length > 0 ||
        diff.row_diffs.mismatched.length > 0;
      if (rowDiffExists) {
        rowFailures.push(tableName);
        logDiffPreview(tableName, diff, DIFF_PREVIEW_LIMIT);
      }
    }
  } finally {
    db.close();
  }

  const attachments = await diffAttachments(
    beforePaths.attachmentsDir,
    afterPaths.attachmentsDir,
    options.sampleSize,
    options.caseFoldPaths,
  );
  const attachmentsMismatch =
    !attachments.counts.ok ||
    !attachments.bytes.ok ||
    attachments.sha_mismatches.length > 0 ||
    attachments.sample_mismatches.length > 0;

  const dbForHealth = new Database(afterPaths.dbPath, { readonly: true, fileMustExist: true });
  let health: HealthReportSummary;
  try {
    health = await runHealthChecks(dbForHealth, afterPaths.dbPath, options.strict);
  } finally {
    dbForHealth.close();
  }
  const healthMismatch = !health.ok;

  const countsMismatch = countFailures.length > 0;
  const rowsMismatch = rowFailures.length > 0;

  const rowsShouldFail = initialRowDetail;
  const countsShouldFail = options.failOn.has('counts');
  const attachmentsShouldFail = options.failOn.has('attachments');
  const healthShouldFail = options.failOn.has('health');

  let exitCode = 0;
  let status = 'PASS';
  if (healthMismatch && healthShouldFail) {
    status = 'FAIL_HEALTH';
    exitCode = 13;
  } else if (attachmentsMismatch && attachmentsShouldFail) {
    status = 'FAIL_ATTACHMENTS';
    exitCode = 12;
  } else if (countsMismatch && countsShouldFail) {
    status = 'FAIL_COUNTS';
    exitCode = 10;
  } else if (rowsMismatch && rowsShouldFail) {
    status = 'FAIL_ROWS';
    exitCode = 11;
  }

  const report = {
    meta: buildMeta(options, beforePaths, afterPaths),
    health,
    tables,
    attachments,
    status,
  };

  await writeReport(options.outPath, report);

  const summaryParts: string[] = [];
  if (countFailures.length > 0) summaryParts.push(`counts: ${countFailures.join(', ')}`);
  if (rowFailures.length > 0) summaryParts.push(`rows: ${rowFailures.join(', ')}`);
  if (attachmentsMismatch) summaryParts.push('attachments mismatch');
  if (healthMismatch) summaryParts.push('health check failed');

  const summary = summaryParts.length > 0 ? ` (${summaryParts.join('; ')})` : '';
  console.log(`[roundtrip-verify] status=${status}${summary} -> ${options.outPath}`);

  if (exitCode !== 0) {
    let guidance = '';
    if (status === 'FAIL_COUNTS' && countFailures.length > 0) {
      guidance = `counts mismatch in ${countFailures[0]} — regenerate the export/import pair and compare ${options.outPath}`;
    } else if (status === 'FAIL_ROWS' && rowFailures.length > 0) {
      guidance = `row drift detected in ${rowFailures[0]} — inspect row_diffs in ${options.outPath}`;
    } else if (status === 'FAIL_ATTACHMENTS') {
      guidance = `attachment drift — inspect sha_mismatches in ${options.outPath}`;
    } else if (status === 'FAIL_HEALTH') {
      const failing = health.checks.find((check) => !check.ok);
      guidance = `database health check failed (${failing?.name ?? 'unknown'}) — review health section in ${options.outPath}`;
    }
    if (guidance) {
      console.error(`[roundtrip-verify] guidance: ${guidance}`);
    }
    process.exit(exitCode);
  }
}

main().catch((error) => {
  const err = error as Error;
  console.error(`[roundtrip-verify] error: ${err.message}`);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(99);
});
