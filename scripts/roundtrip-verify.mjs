#!/usr/bin/env node
// Node 22-friendly TS execution via the same preloader used in tests
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Register ts-node and path aliases in a deterministic way
await import('./test-preload.mjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Defer to the TS implementation; it contains its own CLI entrypoint
await import(path.join(__dirname, 'roundtrip-verify.ts'));
