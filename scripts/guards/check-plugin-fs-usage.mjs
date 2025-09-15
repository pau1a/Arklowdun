// scripts/guards/check-plugin-fs-usage.mjs
// Deny direct @tauri-apps/plugin-fs imports outside the sanctioned wrappers.
// Allowed files: src/files/safe-fs.ts, src/files/path.ts
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url)); // repo root from scripts/guards/
const SRC_DIR = join(projectRoot, 'src');

const ALLOWED = new Set([
  normalizePath('src/files/safe-fs.ts'),
  normalizePath('src/files/path.ts'),
]);

const EXT_OK = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

const RE_PATTERNS = [
  /from\s+['"]@tauri-apps\/plugin-fs(?:\/[^'"]*)?['"]/,
  /import\s*\(\s*['"]@tauri-apps\/plugin-fs(?:\/[^'"]*)?['"]\s*\)/,
  /require\s*\(\s*['"]@tauri-apps\/plugin-fs(?:\/[^'"]*)?['"]\s*\)/,
];

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const files = (await walk(SRC_DIR))
    .filter(f => EXT_OK.has(extname(f)));

  const offenders = [];

  for (const file of files) {
    const rel = normalizePath(file.slice(projectRoot.length));
    if (ALLOWED.has(rel)) continue;

    const txt = await fs.readFile(file, 'utf8');
    const lines = txt.split(/\r?\n/);

    lines.forEach((line, idx) => {
      if (RE_PATTERNS.some(re => re.test(line))) {
        offenders.push({
          file: rel,
          line: idx + 1,
          text: line.trim(),
        });
      }
    });
  }

  if (offenders.length) {
    console.error('ERROR: Raw @tauri-apps/plugin-fs imports are forbidden outside the wrapper.\n');
    for (const o of offenders) {
      console.error(` - ${o.file}:${o.line}: ${o.text}`);
    }
    console.error('\nFix: Use src/files/safe-fs.ts (and path.ts) instead of importing the plugin directly.');
    process.exit(1);
  } else {
    console.log('OK: No forbidden @tauri-apps/plugin-fs imports found.');
  }
}

main().catch(err => {
  console.error('Guard failed to run:', err);
  process.exit(1);
});
