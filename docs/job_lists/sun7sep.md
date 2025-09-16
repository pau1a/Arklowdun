# Arklowdun Job List — Sun 7 Sep 2025

> Job List ID: JL-2025-09-07-01  
> This is the first tracked job list. All future job lists implicitly require that all prior job lists are fully complete.  
> **Policy:** No external CI. All checks are local (scripts, make targets, and git hooks).

## Purpose
Stabilise Arklowdun mid-stream and finish key features with minimal regression risk. Work is sliced into PRs with clear objectives, tasks, and acceptance checks. Use the checkboxes to track progress.

## Conventions
- Branch naming: `pr/<number>-<short-name>`
- Commit subject prefix: `[PR-XX]`
- Labels: `backend`, `frontend`, `migrations`, `docs`, `ux`, `perf`, `risk`
- PR order is **mandatory** unless explicitly re-approved.

## Local workflow (no external CI)
- Recommended git hook: `.githooks/pre-push` that runs the commands listed under **Global guards**.  
  Enable with: `git config core.hooksPath .githooks`
- Optional wrappers:
  - `make check` → runs static checks + guards
  - `make test` → runs Rust + TS tests
  - `make build` → release build sanity-check

---

## Global guards (must remain true throughout; run locally)

- [ ] Local guard script **blocks JSON domain writes**  
      Run: `bash scripts/ci/no-json-writes.sh` (local guard script; name retained, no external CI implied)
- [ ] No domain JSON reads outside sanctioned file views  
      Run: `git grep -n '@tauri-apps/plugin-fs' -- src | grep -v 'FilesView'` → **no hits**
- [ ] No direct `invoke(` outside the unified helper  
      Run: `git grep -n 'invoke\\(' -- src | grep -v 'src/api/call.ts'` → **no hits**
- [ ] No `alert(` for error paths in production code  
      Run: `git grep -n 'alert\\(' -- src` → **0** (or dev-only utilities)
- [ ] TypeScript strict passes (no errors)  
      Run: `npm run typecheck` (or `tsc -p tsconfig.json --noEmit`)
- [ ] Rust lints clean  
      Run: `cargo clippy -- -D warnings`
- [ ] Project builds locally  
      Run: `npm run tauri build` (or `npm run tauri dev` sanity-check)
- [ ] Architecture docs present and linked from README

---

## Execution order overview (final)

1. PR-01 Timezone correctness  
2. PR-02 Vehicles: JSON → SQLite  
3. PR-03 Log-level overrides (dev/prod)  
4. PR-04 Unified async access (`call.ts`)  
5. PR-05 Consistent empty states  
6. PR-06 Bills due-date range query (INTEGER)  
7. PR-07 In-app import trigger (progress streaming)  
8. PR-08 Attachments v1.0 (open/reveal, typed IO errors)  
9. PR-09 Seed data & perf harness (dev-only)  
10. PR-10 Coverage (non-blocking, local only)  
11. PR-11 Recurrence MVP (server-side expansion)  
12. PR-12 Docs & additional guards

---

## PR-01 — Timezone correctness

**Objective**  
Prevent cross-zone time drift by storing explicit timezone (`tz`, IANA) and UTC instants alongside local intents.

**Schema / Migration**
- [ ] `ALTER TABLE events ADD COLUMN tz TEXT;`
- [ ] `ALTER TABLE events ADD COLUMN start_at_utc INTEGER;`
- [ ] `ALTER TABLE events ADD COLUMN end_at_utc INTEGER;`
- [ ] If missing: `ALTER TABLE households ADD COLUMN tz TEXT;` (default IANA zone per household)

**Backfill**
- [ ] Backfill command: interpret existing event times as **local** in `households.tz` (or `'Europe/London'` fallback), compute and write `*_utc`, set `tz`
- [ ] Dry-run mode (counts only); commit mode in transaction per household
- [ ] Emit local progress events (e.g., `events_tz_backfill_progress`); log to file

**UI**
- [ ] Render via `start_at_utc` + `tz` using `Intl.DateTimeFormat({ timeZone: tz, ... })`
- [ ] Mark legacy local columns deprecated and stop reading after backfill completes

**Acceptance (local)**
- [ ] Create event in TZ=A, view on machine in TZ=B → identical wall time
- [ ] Backfill dry-run and commit logs saved in `./logs/events_tz_backfill*.log`
- [ ] Unit tests cover conversion round-trips

**Risks / Notes**
- Do **before** recurrence to avoid compounded date-time bugs.

---

## PR-02 — Vehicles: JSON → SQLite

**Objective**
Eliminate `vehicles.json` from `DashboardView.ts`; serve from DB via typed repo.

**Schema / Migration**
- [ ] Add columns (if missing): `make TEXT`, `model TEXT`, `reg TEXT`, `vin TEXT`, `next_mot_due INTEGER`, `next_service_due INTEGER`
- [ ] Create index `idx_vehicles_household_updated` on `(household_id, updated_at)`

**Backend**
- [ ] Tauri command: `list_vehicles(household_id)` returns typed rows
- [ ] Map DB errors to structured payload

**Frontend**
- [ ] `src/db/vehiclesRepo.ts` with `listVehicles(householdId)` via `call<T>`
- [ ] Replace JSON loader in `DashboardView.ts`
- [ ] Remove `@tauri-apps/plugin-fs` import and any `"vehicles.json"` references

**Acceptance (local)**
- [ ] `git grep -n '"vehicles.json"' -- src` → **no hits**
- [ ] `git grep -n '@tauri-apps/plugin-fs' -- src | grep -i dashboard` → **no hits**
- [ ] Dashboard renders vehicles from DB

**Notes**
- Add `make/model/reg/vin` now to avoid near-term schema churn.
- JSON path `vehicles.json` retired.

---

## PR-03 — Log-level overrides (dev/prod)

**Objective**  
Stop hard-coding log levels; enable runtime overrides aligned with existing env patterns.

**Backend**
- [ ] Read filter from `TAURI_ARKLOWDUN_LOG` with default `"arklowdun=info,sqlx=warn"`
- [ ] Structured JSON logs unchanged

**Frontend**
- [ ] Respect `import.meta.env.VITE_LOG_LEVEL` (`debug|info|warn|error`) in `debug.ts`

**Docs**
- [ ] README examples for dev/prod settings

**Acceptance (local)**
- [ ] Changing env var adjusts verbosity without rebuild

---

## PR-04 — Unified async access

**Objective**  
Centralise `invoke` calls for typing and error normalisation.

**Frontend**
- [ ] `src/api/call.ts` wrapper with normalised error mapping
- [ ] Replace direct `invoke(` across codebase

**Acceptance (local)**
- [ ] `git grep -n 'invoke\\(' -- src | grep -v 'src/api/call.ts'` → **no hits**

---

## PR-05 — Consistent empty states

**Objective**  
Uniform empty states across all list views.

**Frontend**
- [ ] `src/ui/EmptyState.tsx` component
- [ ] Replace bespoke strings in Files, Settings, Bills, Vehicles, etc.
- [ ] Minimal styles via tokens in theme

**Acceptance (local)**
- [ ] `git grep -n 'No .* yet' -- src` → **0** (replaced by `<EmptyState ... />`)

---

## PR-06 — Bills due-date range query (keep INTEGER)

**Objective**  
Fast upcoming-bills queries server-side using INTEGER `due_date`.

**Schema**
- [ ] `CREATE INDEX IF NOT EXISTS idx_bills_household_due ON bills(household_id, due_date);`

**Backend**
- [ ] Command: `list_bills_due_between(household_id, from_ms, to_ms)` ordered by `due_date`

**Frontend**
- [ ] Replace TS-side filters with repo call

**Acceptance (local)**
- [ ] Manual `EXPLAIN QUERY PLAN` shows index usage
- [ ] Dashboard widget uses server-side range query

---

## PR-07 — In-app import trigger (progress streaming)

**Objective**  
Wrap the CLI importer so it can be run from the UI with progress.

**Backend**
- [ ] Tauri command spawns importer; stream progress via app events; write a local log

**Frontend**
- [ ] Settings → “Import legacy data” modal with progress and final status
- [ ] Feature flags: `VITE_FEATURES_IMPORT=1`, `TAURI_FEATURES_IMPORT=1`

**Acceptance (local)**
- [ ] End-to-end import from UI completes with visible progress and success/failure toast
- [ ] Import log saved to `./logs/import_*.log`

---

## PR-08 — Attachments v1.0

**Objective**  
Make `(root_key, relative_path)` actually usable; open/reveal with typed errors.

**Backend**
- [ ] Commands: `open_attachment(id)`, `reveal_attachment(id)`
- [ ] Error mapping: ENOENT → `IO` error kind

**Frontend**
- [ ] Buttons per record to open/reveal
- [ ] Friendly error UI instead of alerts

**Data integrity**
- [ ] Parent delete policy: `ON DELETE SET NULL` (document choice)

**Acceptance (local)**
- [ ] macOS/Windows: open/reveal works; Linux fallback to path copy + hint
- [ ] Error paths show typed IO errors; no alerts

---

## PR-09 — Seed data & perf harness (dev-only)

**Objective**  
Deterministic local dataset for profiling and repeatable tests.

**Scripts**
- [ ] `scripts/dev/seed.ts` (separate from `scripts/ci/`)
- [ ] Guard: refuse to run unless targeting a dev DB path or `VITE_ENV=development`

**Acceptance (local)**
- [ ] One command seeds N households and M domain rows predictably

---

## PR-10 — Coverage (non-blocking, local only)

**Objective**  
Show baseline coverage locally without blocking merges.

**Frontend**
- [ ] Vitest `--coverage` generates local report under `./coverage`

**Backend**
- [ ] Local coverage via `cargo llvm-cov` if installed; otherwise document `cargo tarpaulin` usage

**Acceptance (local)**
- [ ] Coverage reports generated; developer reviews locally

---

## PR-11 — Recurrence MVP

**Objective**  
Store recurrence rules and expand server-side for read-only calendar rendering.

**Schema**
- [ ] `ALTER TABLE events ADD COLUMN rrule TEXT NULL;`
- [ ] `ALTER TABLE events ADD COLUMN exdates TEXT NULL;` (ISO CSV for MVP)

**Backend**
- [ ] Choose crate (e.g., `rrule`)
- [ ] Range query expands instances based on `rrule`/`exdates`

**Frontend**
- [ ] Read-only display of repeated events

**Acceptance (local)**
- [ ] Calendar shows repeated instances without duplicating rows in the DB

**Notes**
- Requires PR-01 (timezone) to be complete.

---

## PR-12 — Docs & additional guards

**Objective**  
Capture architecture decisions and enforce remaining hygiene locally.

**Docs**
- [ ] `docs/architecture/1-overview.md` (module boundaries; storage; logging/env; feature flags)
- [ ] README links to architecture doc

**Guards (local)**
- [ ] Local script checks flag `@tauri-apps/plugin-fs` imports outside approved modules

**Acceptance (local)**
- [ ] Docs merged; local guard scripts runnable via `make check` or `npm run check-all`

---

## Sign-off checklist (close this job list only when all are true)

- [ ] All PR acceptance checks above are complete
- [ ] Migrations applied and documented; backfills logged under `./logs/`
- [ ] No stray JSON domain reads remain
- [ ] Error surfaces are typed; no `alert(` in prod paths
- [ ] README and architecture docs reflect the current state
- [ ] Version bumped and release notes updated
- [ ] Tag created and pushed (local `git tag` + `git push --tags`)
