# PR-3 Mandate — Backfill Trigger (CLI/UI) + Progress & Cancellation

## Objective
Provide safe, explicit ways to **start, observe, pause/resume, and complete** the timezone backfill introduced in PR-1, without changing data semantics.  
Offer one **CLI entry** for operators and one **UI entry** for users (in Settings), both emitting clear progress and completion signals.

---

## Scope
- **Entry points**
  - **CLI:** a subcommand (e.g., `time backfill`) with flags for `--dry-run`, `--chunk-size`, `--progress-interval`, `--household`, `--default-tz`, `--resume`.
  - **UI:** a minimal Settings panel section **“Time & Timezone Maintenance”** with a **Start Backfill** button, **Dry-run** toggle, **Chunk size** input (guarded), and **default TZ** dropdown (optional).
- **Progress events**
  - Emit structured progress signals at a configurable interval to:
    - stdout (CLI) as **newline-delimited JSON** (machine readable), and
    - the app (UI) via the existing event bus/IPC channel as typed events.
- **Cancellation/Resume**
  - UI: **Cancel** button; leaving the screen does not corrupt state.
  - CLI: ^C (SIGINT) cancels gracefully after current chunk.
  - **Resume** uses PR-1 checkpoints; no duplicated work.
- **Summaries & logs**
  - On completion or cancel, present a **human-readable summary** and store a short log record (local, no telemetry).

---

## Non-Goals
- No redesign of Settings or global nav.  
- No changes to backfill algorithm or schema (covered by PR-1/PR-2).  
- No telemetry/analytics; all information stays local.  
- No localisation work beyond simple, copy-ready English strings.

---

## User & Operator Experience

### CLI UX
- **Command:** `time backfill [--dry-run] [--chunk-size=N] [--progress-interval=ms] [--household=ID] [--default-tz=Area/City] [--resume]`
- **Stdout (human):** a final table summary unless `--json-summary` is passed.
- **Stdout (stream):** progress as NDJSON with objects like:
  ```json
  {"type":"progress","scanned":5000,"updated":4200,"skipped":800,"remaining":12000,"elapsed_ms":23210,"chunk_size":500}
  {"type":"summary","household_id":"H1","scanned":17000,"updated":15500,"skipped":1500,"elapsed_ms":81234,"status":"completed"}
````

* **Signals:** SIGINT cancels gracefully after the current chunk; exit code 130 on cancel, 0 on success, non-zero on error.

### UI UX (Settings → Time & Timezone Maintenance)

* **Controls (minimal):** Start (primary), Dry-run (checkbox), Chunk size (numeric with sensible bounds), Default TZ (optional, dropdown), Cancel (while running).
* **States:** Idle → Running → Completed or Cancelled → View Summary.
* **Messages (copy-ready):**

  * Idle helper: “Backfill fills in missing UTC timestamps so events display correctly across timezones and DST.”
  * Running status: “Processing… scanned {X}, updated {Y}, skipped {Z}. This can be paused safely.”
  * Completed: “Backfill finished. Updated {Y} events. {Z} skipped. View details.”
  * Cancelled: “Backfill paused after finishing the current step. You can resume later.”
  * Error: “Backfill couldn’t continue: {reason}. No partial changes beyond completed steps.”
* **Accessibility:** Buttons keyboard-operable; live region for progress updates; focus returns to “Start” on completion with a success alert.

---

## Progress, Events & Logging (contract)

* **Progress cadence:** default `progress_interval=1000ms`; throttled in UI to avoid re-renders (<10fps).
* **Event fields:** `scanned`, `updated`, `skipped`, `remaining`, `elapsed_ms`, `chunk_size`, `household_id?`.
* **Summary fields:** `status` ∈ {completed, cancelled, failed}, plus counts and elapsed.
* **Persistence:** append a short local log entry (date, status, counts); respect existing redaction rules; file size cap (reuse project default).
* **No network calls**; all operations remain local.

---

## Safety & Failure Modes

* **Parameter validation:** chunk size clamped to a safe range (e.g., 100–5000). TZ must be a valid IANA zone when provided.
* **Guardrails:** if PR-2 migration guard detects pending data, the UI shows a prompt linking here; if no pending rows, the Start button is disabled with “No backfill needed.”
* **Cancellation safety:** always complete the current transaction; no half-written chunks.
* **Error surfaces:** classify and present *actionable* reasons (e.g., “Database is locked by another task—try again.”).
* **Concurrency:** serialize backfill so only one instance can run; show “Already running” state if a second attempt is made.

---

## Acceptance Criteria

1. **Dual entry points:** CLI subcommand and Settings control are both present and functional.
2. **Resumable:** Cancel mid-run (CLI ^C and UI Cancel) → resume continues without duplicating updates.
3. **Dry-run:** Produces counts with **no** DB mutations (verified by before/after checks).
4. **Structured progress:** NDJSON stream on CLI; typed events in UI; both include required fields.
5. **Summary & logs:** Human summary shown; a local log line persisted with status and totals.
6. **Validation:** Bad inputs (invalid TZ, out-of-range chunk size) are rejected with clear messages; nothing starts.
7. **No telemetry:** No network egress or analytics; all artifacts are local.
8. **A11y:** UI is keyboard accessible; progress updates announced via a live region.

---

## Evidence Required in PR

* **CLI demo:** Terminal transcript showing dry-run → apply run with progress NDJSON and final summary.
* **UI demo:** Short screen capture of start → progress → cancel → resume → complete, plus the summary view.
* **Resumption proof:** Show that `updated` counts do **not** double after resume.
* **Validation proof:** Screenshots/logs for invalid TZ and out-of-range chunk size, showing rejection.
* **Concurrency proof:** Attempt to start a second run while one is active → clear “Already running” message.
* **Local log:** Path and sample line of the persisted summary entry.

---

## Rollback Plan

* Remove the CLI subcommand registration and the Settings section.
* No schema changes introduced; data remains as written by PR-1.
* Document the toggle/flag to hide the Settings section if a fast disable is needed in a hotfix.

---

## PR Title / Description

* **Title:** `feat(time-backfill): add CLI/UI trigger with progress, cancellation, and resume`
* **Body:** Include Objective, Scope, Non-Goals, Acceptance Criteria, Evidence, and Rollback as written above.

---

```
```
