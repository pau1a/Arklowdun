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

- Before opening a PR, ensure migrations are valid:

  ```sh
  ./scripts/check_migrations.sh
  ```

Edit the generated files, run the check script, then commit both `up` and `down` files.
