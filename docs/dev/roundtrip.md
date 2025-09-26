# Round-trip workflow

## Overview
The round-trip workflow drives the deterministic export → wipe → import fixture cycle that feeds the CI guardrail. `scripts/roundtrip.sh` bootstraps a clean workspace, builds the Rust CLI, seeds the canonical large dataset, runs the export/import CLIs, snapshots attachments, and records a context summary for follow-up verification. The script keeps every artifact inside a temporary directory (default: `.tmp/roundtrip`) and appends structured progress messages to `logs/roundtrip.log` for later inspection.【F:scripts/roundtrip.sh†L197-L404】

## Local prerequisites
Before running the workflow locally, make sure the following tools are available:

- **sqlite3** – the orchestration script aborts early when the CLI is missing. `sqlite3` is needed for the migration reset and the verification probes.【F:scripts/roundtrip.sh†L6-L24】
- **Node.js + npm** – the seeder and attachment snapshot helpers execute with `node --loader ts-node/esm`, so a Node 20 runtime with project dependencies installed via `npm ci` is required.【F:scripts/roundtrip.sh†L44-L153】【F:scripts/roundtrip.sh†L253-L260】
- **Rust toolchain (cargo)** – the workflow builds `src-tauri` in release mode to produce the `arklowdun` CLI that powers the export and import stages.【F:scripts/roundtrip.sh†L223-L249】

## Running the workflow locally
1. Install JavaScript dependencies: `npm ci`.
2. Execute the workflow: `bash scripts/roundtrip.sh --seed 42`.

By default the script wipes and recreates `.tmp/roundtrip`, writes the seeded database to `appdata/arklowdun.sqlite3`, copies snapshot summaries into `artifacts/`, and logs each step to `logs/roundtrip.log`.【F:scripts/roundtrip.sh†L197-L324】 Key options include:

- `--seed <value>` – forwards a deterministic seed to the fixture generator (`42` by default).
- `--tmp <path>` – overrides the workspace directory if you need to keep multiple runs side-by-side.
- `--import-mode <merge|replace>` – passes through to `arklowdun db import` (defaults to `replace`).
- `--skip-build` – reuse an existing CLI build instead of compiling every run.
【F:scripts/roundtrip.sh†L13-L24】【F:scripts/roundtrip.sh†L164-L193】

When the orchestration finishes it prints a summary of the workspace, attachments, manifest copy, import report copy, and context JSON. The context file captures all materialized paths, making it straightforward to launch the Phase 3 verifier.【F:scripts/roundtrip.sh†L339-L404】

```bash
CONTEXT=.tmp/roundtrip/context.json
node --loader ts-node/esm scripts/roundtrip-verify.ts \
  --before "$(jq -r '.exportDir' "$CONTEXT")" \
  --after "$(jq -r '.appDataDir' "$CONTEXT")" \
  --out .tmp/roundtrip/artifacts/roundtrip-diff.json
```

The resulting `roundtrip-diff.json` adheres to `roundtrip-diff.schema.json` and records table, attachment, and health check parity.【F:docs/roundtrip-verify.md†L64-L72】

## CI integration
`.github/workflows/roundtrip.yml` wires the workflow into GitHub Actions for manual dispatches. The pipeline first re-validates the large fixture, then runs the round-trip job on Ubuntu with cached Rust builds and the necessary GTK/WebKit dependencies installed. Artifacts under `.tmp/roundtrip` upload automatically on failure for debugging.【F:.github/workflows/roundtrip.yml†L1-L109】

A soft runtime budget warns after 20 minutes, while GitHub's job timeout stops the run at 30 minutes to keep CI latency predictable.【F:.github/workflows/roundtrip.yml†L37-L99】 Developers should use the `--skip-build` flag locally when iterating quickly, or pre-build the CLI before invoking the script in tight loops.【F:scripts/roundtrip.sh†L181-L233】

## Troubleshooting tips
- **Missing system packages:** Install the GTK/WebKit/sqlite3 libraries shown in the CI workflow if the Rust build fails locally.【F:.github/workflows/roundtrip.yml†L52-L61】
- **Lingering state:** Delete `.tmp/roundtrip` (or point `--tmp` elsewhere) when switching between seeds or import modes.【F:scripts/roundtrip.sh†L197-L218】
- **Verification mismatches:** Inspect `.tmp/roundtrip/artifacts/*.json` and rerun `scripts/roundtrip-verify.ts` with `--strict` or additional `--fail-on` categories to surface detailed diffs.【F:docs/roundtrip-verify.md†L19-L72】
- **Attachment inconsistencies:** Compare `pre-export-attachments.json` and `post-attachments.json` in the artifacts directory to see which files diverged.【F:scripts/roundtrip.sh†L209-L324】
