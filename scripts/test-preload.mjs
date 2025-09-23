// scripts/test-preload.mjs
import { register, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve project root + tsconfig explicitly
const ROOT = dirname(fileURLToPath(import.meta.url));          // .../scripts
const PROJECT = join(ROOT, '..');                              // repo root
const TSCONFIG = join(PROJECT, 'tsconfig.json');

// Make ts-node fast & deterministic under Node 22
process.env.TS_NODE_TRANSPILE_ONLY = '1';
process.env.TS_NODE_PROJECT = TSCONFIG;
process.env.TS_NODE_SKIP_IGNORE = '1';

// Avoid double registration across worker threads
if (!globalThis.__TS_NODE_REGISTERED__) {
  // Resolve the ts-node ESM loader file explicitly (Node 22 friendly)
  const require = createRequire(import.meta.url);
  const TS_NODE_ESM = require.resolve('ts-node/esm.mjs');
  register(pathToFileURL(TS_NODE_ESM).href, pathToFileURL(PROJECT)); // 1) register ts-node first
  globalThis.__TS_NODE_REGISTERED__ = true;
}

// Then enable TS path aliases (@lib, @ui, …) via a lightweight loader wrapper.
// Important: register AFTER ts-node so it can delegate to ts-node's hooks.
const aliasLoaderUrl = new URL('./test-loader.mjs', import.meta.url);
register(aliasLoaderUrl.href, pathToFileURL(PROJECT));
