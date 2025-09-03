import { spawnSync } from 'node:child_process';
import type { Event } from '../src/models.ts';

try {
  const example: Event = {
    id: 'ts-id',
    household_id: 'ts-household',
    title: 'from ts',
    starts_at: 1,
    reminder: 2,
    created_at: 3,
    updated_at: 3,
  };

  const input = JSON.stringify(example);
  const run = spawnSync('cargo', ['run', '--quiet', '--example', 'roundtrip'], {
    cwd: 'src-tauri',
    input,
  });
  if (run.status !== 0) {
    throw new Error(run.stderr.toString());
  }
  const roundtrip: Event = JSON.parse(run.stdout.toString());
  console.log('TS -> Rust -> TS equal:', JSON.stringify(roundtrip) === input);

  const run2 = spawnSync('cargo', ['run', '--quiet', '--example', 'roundtrip'], {
    cwd: 'src-tauri',
  });
  if (run2.status !== 0) {
    throw new Error(run2.stderr.toString());
  }
  const fromRust: Event = JSON.parse(run2.stdout.toString());
  console.log('Rust -> TS title:', fromRust.title);
} catch (err) {
  console.error(err);
  process.exit(1);
}
