# Contributing

Thank you for helping improve this project.

### Migrations

- Use paired files: `NNNN_label.up.sql` and `NNNN_label.down.sql` (4-digit, gapless).
- Do **not** include `BEGIN`, `COMMIT`, or `PRAGMA` statements in migration SQL; the runner manages transactions and foreign keys.
- Start from the template:

  ```sh
  # List existing migrations
  ls migrations

  # Create a new migration from the template
  ./scripts/new_migration.sh "add widgets table"

  # This creates:
  #   migrations/00XX_add_widgets_table.up.sql
  #   migrations/00XX_add_widgets_table.down.sql
  ```

- Before opening a PR, ensure migrations are valid and idempotent:

  ```sh
  ./scripts/check_migrations.sh
  npm run migrations:idempotency
  ```

After running migrations locally (which creates `dev.sqlite`), verify the schema stays in sync:

```sh
npm run schema:verify
```

If `schema:verify` complains that the database is missing, run your migrations first.

If `schema.sql` is missing or DDL changes, regenerate the canonical file:

```sh
npm run schema:update
```

To verify from a clean database the way CI does, run:

```sh
npm run schema:ci
```

Edit the generated files, run the check script, then commit both `up` and `down` files.
Refer to [docs/migration-guidelines.md](docs/migration-guidelines.md) for rollback patterns, commenting standards, and testing expectations.
