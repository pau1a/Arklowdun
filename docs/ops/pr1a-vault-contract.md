# PR1A — Vault Enforcement, Category Model, Migration

## Objective

Deliver a deterministic, household-scoped attachment vault rooted at `attachments/<household_id>/<category>/<relative_path>`, protected by IPC guardrails and backed by a shared `AttachmentCategory` model. Provide a resumable migration path from legacy attachment storage along with operator-facing tooling in Settings.

## Scope

* Centralised vault path resolution for every attachment read/write/list operation.
* Canonical attachment categories shared between backend (Rust) and frontend (TypeScript).
* Strict filename and path validation at the IPC boundary with meaningful error surfaces and hashed logging.
* Database schema updates to include non-null `category` columns with uniqueness constraints across `(household_id, category, relative_path)`.
* Migration job capable of dry-run and apply phases, resumable with checkpoints, conflict-safe, and restricted to app-controlled locations.
* Settings surface that enables operators to run the migration, monitor progress, and retrieve redacted manifests.

## Out of Scope

* Attachment content hashing or deduplication.
* File moves, renames, or user-initiated path edits post-migration.
* Automatic filesystem cleanup when households are deleted.
* UI upgrades beyond the Settings storage card.

## Deliverables

1. **Vault Path Resolver**
   * Backend utility module that derives canonical absolute paths from `(household_id, category, relative_path)` tuples.
   * Ensures all filesystem activity flows through guardrail checks (no absolutes, symlinks, traversal, reserved names, or over-length components).
   * Emits hashed path representations for logs alongside household ID and category.
   * Integrates with existing IPC endpoints (open, reveal, write, list, delete) replacing any direct filesystem concatenation.

2. **AttachmentCategory Source of Truth**
   * Define categories as lower-case, hyphen-free identifiers stable for directory naming.
   * Implement single definition in backend (Rust) that generates TypeScript enum/types via build script.
   * Add CI parity check that fails when backend and frontend artifacts drift.
   * Validate category at IPC entry, rejecting unknown values with `INVALID_CATEGORY` errors.

3. **Guardrail Enforcement**
   * Reject absolute paths, symlink components, and path traversal (`..`, Unicode equivalents).
   * Normalize filenames to NFC before persistence; retain original user labels for display.
   * Enforce per-component ≤255 byte limit and overall path length ≤32k bytes.
   * Block Windows-reserved names and forbidden characters, trailing spaces/dots.
   * Surface explicit error codes (`PATH_OUT_OF_VAULT`, `SYMLINK_DENIED`, `FILENAME_INVALID`, `NAME_TOO_LONG`, etc.).
   * Audit logs capture allow/deny decisions with reason codes and hashed identifiers.

4. **Database Schema Alignment**
   * Add `category TEXT NOT NULL` (or equivalent) to all attachment-bearing tables with CHECK constraints referencing valid categories.
   * Enforce unique `(household_id, category, relative_path)` for active (non-deleted) rows.
   * Retain legacy `root_key` only for migration discovery; new writes must omit or set to canonical vault marker.
   * Provide housekeeping query/test ensuring no `category IS NULL` rows after migration completion.

5. **Migration Workflow**
   * Discovery scans for rows lacking category or using legacy `root_key` values.
   * Infer legacy filesystem source paths with strict validation, skipping entries outside managed directories and recording as unsupported.
   * Compute target vault paths via resolver; apply deterministic conflict renaming (`basename (n).ext`).
   * Dry-run computes full plan (counts, conflict projections, unsupported entries) without touching disk.
   * Apply copies then deletes legacy files atomically; updates DB row only after successful move; never deletes sources outside app data tree.
   * Persist checkpoints per table/row cursor allowing resume after crashes; apply phase streams progress events ≥ every 200ms.
   * Produce manifest summarizing operations with hashed/redacted paths for later review.
   * Post-apply assertion that zero legacy rows remain and all moved files exist under the vault tree.

6. **Settings Storage Interface**
   * Extend Storage card with vault status badge (“Vault: configured” / pending migration).
   * Provide dry-run and apply controls with confirmation prompts and disabled states during execution.
   * Present progress bar, live counts (processed, copied, skipped, conflicts, unsupported), and link to manifest.
   * On completion, show success indicator or actionable guidance for unsupported leftovers.

## Testing Commitments

* **Backend Unit Tests**
  * Path guard coverage for absolute paths, traversal, symlinks, reserved names, length limits.
  * Unicode normalization ensuring NFC/NFD inputs resolve to identical storage paths.

* **Backend Integration Tests**
  * Dry-run vs apply parity (counts and resolutions match).
  * Checkpoint resume validation by interrupting and resuming migration.
  * Conflict resolution stability under retried runs.
  * Household scoping enforcing isolation across households.

* **Frontend Tests**
  * Generated TypeScript enum parity with backend definition.
  * Settings migration flow: dry-run, apply, progress rendering, error surfacing.

* **Optional E2E**
  * Seed mixed legacy dataset, execute migration, verify filesystem and database invariants.

## Operational Guardrails

* Migration handles ≥10k attachments without blocking UI; progress events ≥ every 200ms.
* Vault operations complete validation in ≤5ms typical; slow paths logged.
* Migration summaries streamed to avoid unbounded memory usage.
* Structured logging only includes hashed paths plus household/category metadata; no raw path leakage.
* Feature flag available to disable Settings migration entry point without reverting guardrails.

## Acceptance Checklist

- [x] Non-null `category` with validation and uniqueness enforced on all attachment tables.
- [x] Universal use of vault resolver in backend attachment IPC paths.
- [x] Guardrails applied to all IPC calls with explicit error codes and logging.
- [x] Settings-based migration flow with dry-run, apply, progress, resume, and manifest access.
- [x] Post-migration state free of legacy rows with filesystem reflecting `household/category` layout.
- [x] Enum parity check active in CI.
- [x] Structured logs omit raw paths and include outcome codes.
- [x] Performance budgets satisfied for migration and single-file operations.

### Design Note: Vehicles and Notes Categories

The `vehicles` and `notes` slugs remain part of `AttachmentCategory` even though attachments for those domains flow through
related tables today. Maintaining the slugs prevents churn in on-disk directory names, keeps IPC validation forward-compatible
with future attachment entry points, and ensures the database CHECK constraints continue to accept the complete category list
so rows can migrate between categories without schema edits.

## Rollout & Backout

* Ship guardrails immediately to protect new writes; expose migration controls in Settings.
* To back out, disable migration UI via feature flag while keeping guardrails and vault enforcement active; do not reintroduce legacy root usage.

## Risks & Mitigations

* Enum drift → automated generation + CI parity gate.
* Legacy paths outside app control → dry-run/apply skip with manifest reporting; no destructive default action.
* Windows locks / copy errors → non-fatal skips with retries and logging; user prompted to retry.
* Unicode edge cases → NFC normalization and targeted tests with composed/decomposed samples.
* User interruption mid-run → checkpoints ensure idempotent resume without manual cleanup.
