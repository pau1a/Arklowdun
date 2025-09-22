# Drop legacy events time columns

## Summary
- Migration `0023_events_drop_legacy_time` rebuilds the `events` table to drop the legacy `start_at` and `end_at` columns while enforcing non-null `start_at_utc` values.
- A new boot guard rejects application start-up when the legacy columns are still present, ensuring the migration cannot be bypassed.
- This runbook documents the prerequisites, forward/rollback steps, validation queries, and the evidence bundle captured for review.

## Prerequisites
- The UTC backfill must be complete: `cargo run --manifest-path src-tauri/Cargo.toml --bin migrate -- check` should report `All events have UTC timestamps.` and zero pending households.
- Confirm no application nodes are running against the database while migrations execute.
- Take a fresh backup or snapshot of the SQLite database before applying the migration.
- Ensure the desktop build contains the new guard (commit introducing `enforce_events_legacy_columns_removed`).

## Forward migration
1. Apply all pending migrations:
   ```bash
   cargo run --manifest-path src-tauri/Cargo.toml --bin migrate -- --db /path/to/arklowdun.sqlite up
   ```
   The command should report a plan ending with `0023_events_drop_legacy_time.up.sql`.
2. If the run aborts with `NOT NULL constraint failed: events_new.start_at_utc`, re-run the UTC backfill using the maintenance CLI and retry:
   ```bash
   cargo run --locked --manifest-path src-tauri/Cargo.toml --bin time -- \
     backfill --db /path/to/arklowdun.sqlite3 --household <HOUSEHOLD_ID> \
     --resume --chunk-size 500 --progress-interval 0
   ```
   See [ops/backfill-guard.md](ops/backfill-guard.md) for guidance on selecting the household scope and default timezone.
3. After success, refresh the canonical schema snapshot if required:
   ```bash
   npm run schema:update
   npm run schema:verify
   ```
4. Run the guard check to confirm the new invariant:
   ```bash
   cargo run --manifest-path src-tauri/Cargo.toml --bin migrate -- --db /path/to/arklowdun.sqlite check
   ```
   Expected output includes `Legacy events columns: OK (start_at/end_at dropped).`

## Rollback (developer safety net)
> ⚠️ Rollbacks are dev-only. Production rollbacks require a database restore.

1. Export or snapshot the database before proceeding.
2. Allow down migrations locally:
   ```bash
   ARKLOWDUN_ALLOW_DOWN=1 cargo run --manifest-path src-tauri/Cargo.toml --bin migrate -- --db /path/to/arklowdun.sqlite down --to 0022
   ```
   This rebuilds `events` with the legacy columns present but populated with `NULL` placeholders.
3. Restart the application only after ensuring no new UTC-only code paths depend on the dropped columns. Do **not** cold-start a post-0023 binary against the rolled-back schema; use a pre-0023 build or the CLI only.

## Validation queries
Run the following after applying the migration:

- Verify the head migration is present:
  ```sql
  SELECT version, applied_at
    FROM schema_migrations
   WHERE version = '0023_events_drop_legacy_time.up.sql';
  ```
  The `schema_migrations.version` column stores the full migration filename, including the `.up.sql` suffix.
- Confirm the legacy columns are gone:
  ```sql
  SELECT name
    FROM pragma_table_info('events')
   WHERE name IN ('start_at', 'end_at');
  -- Expect zero rows
  ```
- Audit the required indexes now that only UTC timestamps remain:
  ```sql
  PRAGMA index_list('events');
  ```
  Ensure `events_household_start_at_utc_idx` and `events_household_end_at_utc_idx` are both present.
- Sanity-check query plans to prove the UTC index is exercised:
  ```sql
  EXPLAIN QUERY PLAN
    SELECT id
      FROM events
     WHERE household_id = ?
       AND start_at_utc BETWEEN ? AND ?;
  ```
  Expect the output to reference `events_household_start_at_utc_idx`, for example:
  ```
  QUERY PLAN
  `--SEARCH events USING INDEX events_household_start_at_utc_idx (household_id=? AND start_at_utc>? AND start_at_utc<?)
  ```

## Guard behaviour
- On application start, `enforce_events_legacy_columns_removed` logs `events_legacy_column_check` and blocks launch with `events_legacy_columns_present` when the legacy schema persists.
- Operators can dry-run the guard via `cargo run --bin migrate -- check`; any failure indicates the application binary would refuse to boot until the columns are removed.

## Evidence bundle
| Artifact | Description |
| --- | --- |
| [`docs/evidence/drop-legacy/migration-pass.log`](evidence/drop-legacy/migration-pass.log) | Full migration run including the plan and schema_migrations snapshot proving `0023` applied.
| [`docs/evidence/drop-legacy/migration-fail.log`](evidence/drop-legacy/migration-fail.log) | Demonstration of the migration aborting with `NOT NULL` when residual legacy data exists.
| [`docs/evidence/drop-legacy/guard-block.log`](evidence/drop-legacy/guard-block.log) | Guard invocation showing the blocking log entries and user-facing error when `start_at` / `end_at` remain.
| [`docs/evidence/drop-legacy/schema-diff.txt`](evidence/drop-legacy/schema-diff.txt) | Schema diff confirming the removal of `start_at` / `end_at` and the promotion of `start_at_utc` to `NOT NULL`.
| [`docs/evidence/drop-legacy/schema-before.sql`](evidence/drop-legacy/schema-before.sql) | Baseline schema snapshot before applying `0023`.
| [`docs/evidence/drop-legacy/schema-before.sha256`](evidence/drop-legacy/schema-before.sha256) | SHA-256 checksum for the deterministic `schema-before.sql` dump.
| [`docs/evidence/drop-legacy/schema-after.sql`](evidence/drop-legacy/schema-after.sql) | Schema snapshot after the migration succeeds.
| [`docs/evidence/drop-legacy/schema-after.sha256`](evidence/drop-legacy/schema-after.sha256) | SHA-256 checksum verifying the `schema-after.sql` dump.
