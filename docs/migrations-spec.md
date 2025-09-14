# Migrations Specification

Arklowdun uses numbered SQL files to evolve the database schema.  Each migration
is applied exactly once in order and is expected to succeed without manual
intervention.

![Linear sequence of migrations](migrations-sequence.svg)

## Version numbers

- Migrations live in the top-level `migrations/` directory.
- Every change consists of paired files: `NNNN_label.up.sql` and
  `NNNN_label.down.sql`.
- `NNNN` is a zero-padded, gapless four-digit counter.
- `label` is a short snake_case description and carries no semantic meaning
  beyond readability.
- New migrations append the next number; **existing numbers are never
  renumbered** once committed.
- Numbers only establish ordering; they do not express compatibility or
  semantic versioning.

## Upgrade path

- The runner applies migrations strictly in ascending order.
- All migrations must be present and applied sequentially; skipping versions is
  not supported.
- Downgrades are not provided. `*.down.sql` files exist only as references for
  rebuild patterns and may be used during development, but production systems
  move forward only.
- Failed migrations are wrapped in a transaction via `with_tx`; an error rolls
  back the entire migration.

## Backfill logic

- Backfills (e.g., populating a newly added column) may be included in the
  `*.up.sql` file when the data is small and deterministic.
- Large or iterative backfills should be handled by application code after the
  schema upgrade completes.

## Example major transition

Adding a time zone column to events illustrates a feature-sized change:

![Adding tz column to events](migrations-add-tz.svg)

## Fixtures

The file `src-tauri/tests/fixtures/sample.sql` captures the schema produced by
applying all migrations. Tests load this fixture to ensure migrations remain in
sync with application expectations.

## References

- `scripts/check_migrations.sh` verifies numbering and pairing.
- `scripts/renumber_migrations.sh` can renumber unpublished migrations but
  should not be used on committed history.
