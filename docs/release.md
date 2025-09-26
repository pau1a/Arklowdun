# Release

## Pending migrations check

The release process verifies that the target database has applied all migrations found in `migrations/`.

### Running the check manually

```sh
scripts/check_pending_migrations.sh [path/to/db.sqlite]
```

The script reads the database path from its first argument or the `DB` environment variable, defaulting to `dev.sqlite`. It compares the migration filenames in `migrations/*.up.sql` with the contents of the `schema_migrations` table. Tokens are matched exactly—the full basename including `.up.sql` is stored in `schema_migrations.version`. If any filenames are missing, the script exits non-zero and lists the pending migrations.

### What "pending migrations" means

A migration is pending when an `*.up.sql` file exists on disk but its version is absent from the `schema_migrations` table in the target database. Shipping the app with pending migrations means the database schema is behind what the code expects.

### Fixing pending migrations

Apply outstanding migrations before releasing:

```sh
cargo run --bin migrate -- --db "$DB" up
```

After the database is up to date, rerun the check to confirm it prints:

```
OK: No pending migrations
```

## Building a release

Use the `release` npm script to build the application bundle. It now ensures the copyleft audit record is in sync before running other guards and runs the pending migrations check before invoking the Tauri build. The script checks `dev.sqlite` by default:

```sh
npm run release
```

The build aborts if:

- The copyleft audit hashes in `docs/licensing/copyleft-audit-record.yaml` do not match the current lockfiles or remediation items remain open.
- Any migrations are missing from the target database.

See `docs/licensing.md` for the audit methodology, evidence locations, and remediation tracking expectations. Confirm there are no outstanding `open` or `blocked` remediation entries before shipping.

## File system allowlist

File system access is now limited to the application's data directory (DB, logs, settings) and its `attachments/` subfolder. Desktop, Downloads, and other home directories are no longer reachable via the FS plugin. External paths must use a future sanctioned mechanism; see `docs/security/fs-allowlist.md`.
