#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...options });
}

function hasCargoLlvmCov() {
  const res = run('cargo', ['llvm-cov', '--version']);
  return res.status === 0;
}

function ensureLlvmTools() {
  const res = run('rustup', ['component', 'list', '--installed']);
  if (res.status !== 0 || !res.stdout.includes('llvm-tools-preview')) {
    console.log('rustup component add llvm-tools-preview');
    return false;
  }
  return true;
}

function printFallback() {
  console.log('cargo install cargo-llvm-cov');
  console.log('rustup component add llvm-tools-preview');
  console.log('cargo install cargo-tarpaulin');
  console.log('cargo tarpaulin -v --timeout 120 --out Html --out Lcov --engine SourceAnalysis');
}

function main() {
  if (!hasCargoLlvmCov()) {
    printFallback();
    process.exit(0);
  }

  if (!ensureLlvmTools()) {
    process.exit(0);
  }

  mkdirSync('coverage-rust', { recursive: true });
  const result = spawnSync('cargo', [
    'llvm-cov',
    '--workspace',
    '--lcov',
    '--output-path', 'coverage-rust/lcov.info',
    '--html',
    '--html-dir', 'coverage-rust/html'
  ], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

main();
