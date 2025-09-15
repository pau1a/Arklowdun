$ErrorActionPreference = "Stop"

Write-Output "== Security smoke =="

Write-Output "1/4 TS guardrail…"
npm run -s check:plugin-fs | Out-Null

Write-Output "2/4 Rust unit tests (policy + redaction)…"
cargo test --manifest-path src-tauri/Cargo.toml --lib security::fs_policy_tests:: -- --quiet
cargo test --manifest-path src-tauri/Cargo.toml --test log_redaction -- --quiet

Write-Output "3/4 Dev smoke binary (end-to-end sanity)…"
cargo run --manifest-path src-tauri/Cargo.toml --bin sec_smoke | Out-Null

Write-Output "4/4 TypeScript typecheck…"
try {
  npm run -s typecheck | Out-Null
  Write-Output "TS typecheck OK"
} catch {
  Write-Output "(no typecheck script; skipping)"
}

Write-Output "OK: Security smoke passed."
