#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcDir = join(root, 'src-tauri', 'src');

const allowlist = new Set([
  'vehicles_list',
  'vehicles_get',
  'events_list_range',
  'bills_list_due_between',
  'household_get_active',
  'household_set_active',
  'db_table_exists',
  'db_has_files_index',
  'db_files_index_ready',
  'db_has_vehicle_columns',
  'db_has_pet_columns',
  'db_get_health_report',
  'db_recheck',
  'db_import_preview',
  'db_backup_overview',
  'db_backup_create',
  'db_backup_reveal_root',
  'db_backup_reveal',
  'db_export_run',
  'search_entities',
  'attachment_open',
  'attachment_reveal',
  'open_path',
  'diagnostics_summary',
  'about_metadata',
  'diagnostics_doc_path',
  'open_diagnostics_doc',
  'time_invariants_check',
  'events_backfill_timezone_cancel',
  'events_backfill_timezone_status',
]);

function collectRustFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRustFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      files.push(full);
    }
  }
  return files;
}

function parseCommands(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const commands = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#[tauri::command]')) continue;

    let sigIndex = i + 1;
    while (sigIndex < lines.length && lines[sigIndex].trim().startsWith('#[')) {
      sigIndex++;
    }
    if (sigIndex >= lines.length) break;

    let signature = lines[sigIndex].trim();
    if (signature.startsWith('pub async fn')) {
      signature = signature.slice('pub async fn'.length).trim();
    } else if (signature.startsWith('async fn')) {
      signature = signature.slice('async fn'.length).trim();
    } else if (signature.startsWith('pub fn')) {
      signature = signature.slice('pub fn'.length).trim();
    } else if (signature.startsWith('fn')) {
      signature = signature.slice('fn'.length).trim();
    }
    const name = signature.split('(')[0].trim();

    let bodyStart = sigIndex;
    while (bodyStart < lines.length && !lines[bodyStart].includes('{')) {
      bodyStart++;
    }
    if (bodyStart >= lines.length) break;

    let braceDepth = 0;
    const body = [];
    for (let k = bodyStart; k < lines.length; k++) {
      const current = lines[k];
      const opens = (current.match(/\{/g) || []).length;
      const closes = (current.match(/\}/g) || []).length;
      braceDepth += opens - closes;
      body.push(current);
      if (braceDepth === 0 && k > bodyStart) {
        break;
      }
    }

    commands.push({
      name,
      line: sigIndex + 1,
      body: body.join('\n'),
    });
    i = bodyStart;
  }
  return commands;
}

const errors = [];
const files = collectRustFiles(srcDir);
for (const file of files) {
  const commands = parseCommands(file);
  for (const command of commands) {
    if (/[\[<]/.test(command.name)) {
      continue;
    }
    if (
      command.body.includes('ensure_db_writable') ||
      command.body.includes('begin_maintenance')
    ) {
      continue;
    }
    if (allowlist.has(command.name)) {
      continue;
    }
    errors.push({
      file: relative(root, file),
      name: command.name,
      line: command.line,
    });
  }
}

if (errors.length > 0) {
  console.error('The following #[tauri::command] functions do not call ensure_db_writable:');
  for (const err of errors) {
    console.error(`  ${err.file}:${err.line} → ${err.name}`);
  }
  console.error('\nAdd the guard call or update scripts/guards/require-db-write-guard.mjs allowlist if the command is read-only.');
  process.exit(1);
}
