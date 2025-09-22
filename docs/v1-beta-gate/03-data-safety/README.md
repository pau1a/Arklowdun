# Data Safety & Recovery Roadmap

This document defines the phased plan and pull request breakdown for implementing robust data safety and recovery in the app.

---

## Phases (A–E)

### A. Detect (DB Health)
- Run `PRAGMA integrity_check=1`, `PRAGMA quick_check`, `PRAGMA foreign_key_check`.
- Verify WAL presence and size sanity, page size, journal mode.
- Structured health report (status, checks, timings, offenders, schema hash, app version).
- UI: banner + “Details…” drawer; CLI `db status` returns JSON + human formats.
- Guard: block all mutating IPC (create/update/delete/import) if health ≠ OK.

**Exit:** App always detects corruption before writes and reports clearly.

---

### B. Backup (Safe Snapshot)
- Atomic snapshot via SQLite backup API or `VACUUM INTO`.
- Store under `backups/YYYYMMDD-HHMMSS/arklowdun.sqlite3`.
- Generate `manifest.json` with app version, schema hash, size, sha256.
- Retention: keep last 5 or ≤2 GB, evict oldest-first.
- UI: Settings → “Create Backup”; show size estimate, then “Reveal”/“Copy path”.

**Exit:** Snapshot always succeeds or fails cleanly; never partial files.

---

### C. Repair (Guided & Hard)
- **Guided repair flow:**
  1. Auto-backup (reuse B).
  2. WAL checkpoint if present.
  3. `VACUUM INTO` → new DB.
  4. Validate new DB with integrity/foreign_key_check.
  5. Atomic swap (new → live; old → archived).
- On success: banner “Repair complete”; on failure: rollback and read-only.
- **Hard repair:** Table export/import by FK graph when VACUUM fails.
- Skipped rows logged; Recovery Report JSON downloadable.

**Exit:** Typical corruption repaired automatically; severe corruption recovers max data with omissions report.

---

### D. Export/Import (Round-trip Safety)
- **Export:**
  - Structure: `manifest.json` (schema/app version, counts, sha256), `data/*.jsonl`, `attachments/`.
  - Deterministic ordering; `verify.sh` / `.ps1` script for checksum re-check.
  - UI: Settings → “Export Data”.
- **Import:**
  - Preflight: version/schema check, space estimate, counts, conflict detection.
  - Modes: Replace (wipe/load) or Merge (newer-wins).
  - Dry-run produces deterministic plan; execution matches plan.
- **Round-trip CI:**
  - Fixture with ≥10k events, ≥5k notes, attachments.
  - CI: seed → export → wipe → import → verify counts & hashes.

**Exit:** Export/import round-trip is deterministic and proven at scale.

---

### E. Observability (Local Evidence)
- Every operation (check, backup, repair, export, import) writes a JSON report:
  - id, start/stop, outcome, metrics, file paths, counts, errors/omissions.
- UI: “Open latest report” + Settings list of last 10.
- Docs:
  - `docs/recovery.md` with screenshots, strings, flows.
  - `docs/admin/db-ops.md` with CLI usage and examples.

**Exit:** Users and maintainers can prove outcomes locally; no guesswork.

---

## PR Breakdown

### PR-01: Startup DB Health Checks
- Add startup health checks (integrity, quick, FK, WAL, page size, journal mode).
- Produce structured health report.
- UI: banner + details drawer; CLI `db status`.
- Tests: clean DB, FK violation, WAL junk, page mismatch.

### PR-02: Write-path Guardrail
- Block all mutating IPC if health ≠ OK.
- Stable error code: `DB_UNHEALTHY_WRITE_BLOCKED`.
- UI maps to banner with “Repair” button.
- Tests: induced corruption → writes blocked.

### PR-03: One-Click Backup + Retention
- Snapshot with manifest.json.
- Retention: last 5 or ≤2 GB.
- UI: “Create Backup” button with size estimate.
- Tests: low disk, locked DB, long paths.

### PR-04: Guided Repair
- Auto-backup → WAL checkpoint → `VACUUM INTO` → validate → atomic swap.
- Old DB archived to `backups/pre-repair-<ts>/`.
- UI: “Repair” button with step progress.
- Tests: typical corruption → success; power-cut simulation → rollback safe.

### PR-05: Hard Repair
- FK-ordered table export/import with skipped row logging.
- Recovery Report JSON with counts/errors.
- UI: “Recovered with omissions” banner + download.
- Tests: synthetic corrupt tables → partial import.

### PR-06: Export Package
- Export `manifest.json`, `data/*.jsonl`, `attachments/`.
- Deterministic; verify script included.
- UI: “Export Data” with target dir chooser.
- Tests: Unicode paths, large attachments, low disk.

### PR-07: Import with Preflight
- Preflight check (schema/app version, counts, conflicts).
- Modes: Replace vs Merge (newer-wins).
- Dry-run plan diff; execution matches plan.
- Tests: version mismatch, merge conflicts, replace.

### PR-08: Round-Trip CI Fixture
- Fixture: ≥10k events, ≥5k notes, attachments.
- CI job: seed → export → wipe → import → verify counts & hashes.
- Artifacts include diff report.

### PR-09: Operation Reports
- JSON report for each operation.
- Fields: id, start/stop, outcome, metrics, counts, errors/omissions.
- UI: “Open latest report” + list last 10.
- Tests: schema validation of reports.

### PR-10: Docs & UX Copy
- `docs/recovery.md` (screenshots, flows).
- `docs/admin/db-ops.md` (CLI usage).
- Stable strings for all banners, toasts, errors.
- CI check for missing string keys.

---

## Mapping: PRs ↔ Phases

- **A. Detect** → PR-01, PR-02  
- **B. Backup** → PR-03  
- **C. Repair** → PR-04, PR-05  
- **D. Export/Import** → PR-06, PR-07, PR-08  
- **E. Observability** → PR-09, PR-10

---

## Test Matrix

- **Health:** clean DB, FK violation, WAL corruption, bad page, missing index.  
- **Backup:** low disk, long path, locked DB, power loss.  
- **Repair:** checkpoint works/fails, vacuum success/fail, hard repair partial.  
- **Export:** large attachments, Unicode paths, permission denied.  
- **Import:** version mismatch, merge vs replace, conflict plan, checksum mismatch.

---

## Sample User-Facing Strings

- “Database issue detected. Editing is temporarily disabled until repaired.”  
- “Backup created (142 MB). View in Finder/Explorer.”  
- “Repair complete. Your data was verified and restored safely.”  
- “Repair partially succeeded. 7 records could not be restored — download report.”  
- “Not enough disk space (need ~350 MB). Free space or change backup location.”

---

## Sequencing & Ownership

- **PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06/07 → PR-08 → PR-09 → PR-10**  
- Ged: implement code paths and tests.  
- Product: UX copy, error message wording, merge vs replace import policy.  
- CI: enforce round-trip (PR-08) and string coverage (PR-10).

---

**Exit Condition for Phase 3 (Data Safety & Recovery):**  
App can detect corruption, repair without loss, and export/import reliably.
