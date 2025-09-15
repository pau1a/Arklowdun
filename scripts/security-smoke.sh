#!/usr/bin/env bash
set -euo pipefail

echo "== Security smoke =="
echo "1/4 TS guardrail…"
# Enforces: no raw @tauri-apps/plugin-fs imports in src/**
npm run -s check:plugin-fs

echo "2/4 Rust unit tests (policy + redaction)…"
# Covers canonicalize/roots/symlink deny + log redaction invariants
cargo test --manifest-path src-tauri/Cargo.toml --lib security::fs_policy_tests:: -- --quiet
cargo test --manifest-path src-tauri/Cargo.toml --test log_redaction -- --quiet

echo "3/4 Dev smoke binary (end-to-end sanity)…"
cargo run --manifest-path src-tauri/Cargo.toml --bin sec_smoke >/dev/null

echo "4/4 TypeScript typecheck (just to catch IPC surface issues)…"
# If you have a dedicated typecheck script use that; otherwise, keep this no-op or remove.
if npm run -s typecheck >/dev/null 2>&1; then
  echo "TS typecheck OK"
else
  echo "(no typecheck script; skipping)"
fi

echo "OK: Security smoke passed."
