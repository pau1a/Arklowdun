# Pets PR8 — Observability & Diagnostics (P8)

### Objective

Instrument the Pets domain with **structured timings** and **reliable counters**, and surface them in the **one-click diagnostics bundle**. On **any Pets mutation failure**, emit a log that includes a **crash ID**.

**Done means**

* List, detail, and reminder flows emit timing metrics.
* Diagnostics bundle shows pet/medical/attachment counts **and** reminder queue depth.
* Every Pets mutation failure log contains a `crash_id`.

---

## 1) Scope & intent

**In scope**

* Timing instrumentation around:
  * List mount/render/virtualisation cycles.
  * Detail open/CRUD.
  * Reminder scheduling/firing/cancel.
* Failure logging with `crash_id` propagation for **all** Pets mutations (pets + pet_medical + attachments).
* Diagnostics export: row counts, missing-attachment count, active reminder timers/queue depth.
* Minimal UI hooks to expose metrics to the diagnostics collector (no visual UI).

**Out of scope**

* Any UX changes, charts, or new UI panels.
* New schema or IPC commands unrelated to metrics export.

---

## 2) Deliverables

| Deliverable          | Description                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| **Timing helper**    | `src/lib/obs/timeIt.ts` – wraps async ops and logs `{ name, duration_ms, ok }`.                     |
| **UI event timers**  | Pets list/detail/reminder code uses `timeIt(...)` around critical paths.                            |
| **Crash-ID logging** | On mutation failure, `normalizeError(e)` → `{code, message, crash_id}` and log includes `crash_id`. |
| **Diagnostics taps** | Bundle gains `pets` section with counts + reminder queue depth.                                     |
| **Tests**            | Unit + integration verifying logs and diagnostics payload.                                          |
| **Docs**             | Update `/docs/pets/diagnostics.md` with fields & examples; add this PR to plan checklist.           |

---

## 3) Detailed tasks

### 3.1 Timing infrastructure (renderer)

Create `src/lib/obs/timeIt.ts`:

```ts
export async function timeIt<T>(name: string, f: () => Promise<T>) {
  const t0 = performance.now();
  try {
    const res = await f();
    const dt = Math.max(0, performance.now() - t0);
    logUI("perf.pets.timing", { name, duration_ms: Math.round(dt), ok: true });
    return res;
  } catch (e) {
    const dt = Math.max(0, performance.now() - t0);
    const err = normalizeError(e);
    logUI("perf.pets.timing", { name, duration_ms: Math.round(dt), ok: false, code: err.code, crash_id: err.crash_id });
    throw err;
  }
}
```

Use it to wrap:

* **List**: initial load (`petsRepo.list`), virtualised window render (`renderWindow`), inline create/rename/delete.
* **Detail**: medical `create/delete`, attachment `open/reveal`, “Fix path” flow.
* **Reminders**: batch `scheduleMany`, single `reminder_fired`, `cancelAll`.

### 3.2 Mutation failure → crash ID logs

Every Pets mutation already goes through `normalizeError(e)`; ensure **all** these paths re-emit logs with the crash ID:

* `repo.pets.create/update/delete`
* `repo.petMedical.create/delete`
* Attachment open/reveal/fix path handlers

Example failure log:

```json
{
  "ts": "2025-10-10T11:12:13Z",
  "event": "ui.pets.mutation_fail",
  "op": "pet_medical_create",
  "code": "SQLX/FOREIGN",
  "crash_id": "b9b4d8fd-6c12-4a93-b8a3-5a9c2cbbef2f"
}
```

Where possible, include `op`, `id`/`pet_id`, and minimal context (no PII).

### 3.3 Structured timing events

Emit these **names** via `logUI("perf.pets.timing", {...})`:

| Name                      | When                               | Fields                                               |
| ------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `list.load`               | After `petsRepo.list` resolves     | `duration_ms`, `count`                               |
| `list.window_render`      | Each virtualised patch             | `duration_ms`, `rows_rendered`, `from_idx`, `to_idx` |
| `list.create`             | Inline create round-trip           | `duration_ms`, `ok`                                  |
| `list.update`             | Rename/type update                 | `duration_ms`, `ok`                                  |
| `list.delete`             | Delete row                         | `duration_ms`, `ok`                                  |
| `detail.open`             | Opening the detail drawer          | `duration_ms`                                        |
| `detail.medical_create`   | Add medical record                 | `duration_ms`, `ok`                                  |
| `detail.medical_delete`   | Delete medical record              | `duration_ms`, `ok`                                  |
| `detail.attach_open`      | Open attachment                    | `duration_ms`, `ok`                                  |
| `detail.attach_reveal`    | Reveal in Finder                   | `duration_ms`, `ok`                                  |
| `detail.fix_path`         | Broken→fixed flow                  | `duration_ms`, `ok`                                  |
| `reminders.schedule_many` | After PR3 scheduler `scheduleMany` | `duration_ms`, `scheduled`                           |
| `reminders.fire`          | On notification callback           | `duration_ms`                                        |
| `reminders.cancel_all`    | On unmount/household switch        | `duration_ms`, `canceled`                            |

> Note: `list.window_render` is **performance-sensitive**; gate logging frequency to once per ~200ms while scrolling to avoid log spam.

### 3.4 Diagnostics export (bundle)

Add a `pets` section to diagnostics JSON (Settings → Recovery → Export Diagnostics):

```json
"pets": {
  "pets_total": 42,
  "pets_deleted": 1,
  "pet_medical_total": 137,
  "pet_attachments_total": 58,
  "pet_attachments_missing": 6,
  "reminder_active_timers": 12,
  "reminder_queue_depth": 12,
  "last_24h_failures": 2
}
```

Populate via:

* SQLite counts (`SELECT` queries scoped by active household or totals per install).
* Attachment existence probe (fast `exists` check on `relative_path` for `category='pet_medical'`).
* Reminder metrics via PR3 registry `reminderScheduler.stats()`.

Ensure **collectors** (redacted mode) do **not** include pet names/breeds or raw paths; keep counts only. If Python redactor is missing, fall back remains `--raw --yes` (documented elsewhere).

### 3.5 Rust-side spans (optional but recommended)

Wrap Pets IPC handlers (`pets_*`, `pet_medical_*`) with `tracing::info_span!` to include `duration_ms` in backend logs:

```rust
let span = info_span!("ipc", cmd = "pet_medical_create");
let _g = span.enter();
let t0 = Instant::now();
// ... handler ...
info!(name="ipc.result", cmd="pet_medical_create", duration_ms = t0.elapsed().as_millis() as u64, status="ok");
```

These do **not** change behavior; they enrich logs if RUST_LOG enables them.

---

## 4) Tests

### 4.1 Unit tests (renderer)

* `timeIt` logs `ok:true` on success and `ok:false` + `code` + `crash_id` on error.
* Each wrapped path (create/update/delete; medical create/delete) emits exactly **one** timing event per operation.

### 4.2 Integration tests

* Seed 1k pets → scroll list; confirm `list.window_render` logs are rate-limited and include `rows_rendered`.
* Trigger a forced backend failure (e.g., invalid FK) during medical create → verify `ui.pets.mutation_fail` contains `crash_id`.
* Export diagnostics; assert presence of:
  * `pets_total`, `pet_medical_total`
  * `pet_attachments_missing` (seed one missing)
  * `reminder_queue_depth` equals `reminderScheduler.stats().activeTimers`

### 4.3 Redaction check

* Run collector in redacted mode → diagnostics includes counts but no names or file paths.

---

## 5) Acceptance checklist

| Condition                                     | Status | Evidence                           |
| --------------------------------------------- | ------ | ---------------------------------- |
| Timings emitted for list/detail/reminders     | ☐      | `perf.pets.timing` samples in log  |
| Mutation failures always include `crash_id`   | ☐      | `ui.pets.mutation_fail` sample     |
| Diagnostics bundle shows counts + queue depth | ☐      | JSON snippet from one-click export |
| Log spam avoided on scroll (rate-limit)       | ☐      | Max ~5 window_render logs/sec      |
| Redacted export contains no PII               | ☐      | Inspection of bundle               |
| Docs updated (`diagnostics.md`)               | ☐      | Commit diff                        |
| macOS CI passes integration                   | ☐      | Workflow log                       |

---

## 6) Verification workflow

1. **Dev run** with tracing:

   ```bash
   RUST_LOG=info npm run tauri dev
   ```
2. Open `/pets`, scroll top→bottom; confirm periodic `list.window_render` entries.
3. Open a pet; add and delete a medical record; check `detail.medical_*` timings.
4. Force a failed medical create; verify error toast and **log with `crash_id`**.
5. Trigger reminders by creating a soon-due record; observe `reminders.schedule_many` and `reminders.fire`.
6. Export diagnostics (Settings → Recovery → Export) and confirm `pets` section includes counts and `reminder_queue_depth`.

---

## 7) Risks & mitigations

| Risk                             | Mitigation                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Excess log volume during scroll  | Throttle `list.window_render` to ≤ 5 events/sec.                               |
| Missing crash_id propagation     | Ensure `normalizeError` preserves `crash_id` and all catch blocks log it.      |
| Slow attachment existence checks | Batch or limit to visible window; precompute counts lazily during diagnostics. |
| PII leakage in logs              | Log IDs, codes, and counts only — no names/paths.                              |

---

## 8) Documentation updates required

| File                          | Update                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `docs/pets/diagnostics.md`    | Add new fields, sample logs, and bundle JSON example.        |
| `docs/pets/reminders.md`      | Add note: scheduler stats used for diagnostics queue depth.  |
| `docs/pets/ui.md`             | Reference that list/detail actions are timed (no UI change). |
| `docs/pets/plan/checklist.md` | Mark PR8 complete with evidence links.                       |
| `CHANGELOG.md`                | “PR8 – Observability & diagnostics for Pets.”                |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                   |
| ------------- | ----------------- | ------------------------------------------------ |
| **Developer** | Ged McSneggle     | Implement timers, failure logs, diagnostics taps |
| **Reviewer**  | Paula Livingstone | Verify crash-ID presence & bundle content        |
| **CI**        | Automated         | Run integration tests on macOS build             |

---

**Status:** Ready for implementation
**File:** `/docs/pets/plan/pr8.md`
**Version:** 1.0
**Scope:** Structured, low-noise timings + guaranteed crash-ID failure logs, with a diagnostics bundle that shows the Pets counts and reminder queue depth in one click.
