# 🚨 IMPORTANT LIMITATION (TEMPORARY)
Unix collector calls `python3` for redaction. Replace with a bundled helper before any paid/public release.
If `python3` is missing, only `--raw --yes` will proceed (no redaction) with a warning in the bundle README.

# Diagnostics bundles

The `collect-diagnostics` scripts create a redacted archive that can be sent to
support when troubleshooting Arklowdun installs. The scripts exist in both
shell (`scripts/collect-diagnostics.sh`) and PowerShell
(`scripts/collect-diagnostics.ps1`) variants so the same behaviour is available
on macOS/Linux and Windows.

```bash
# macOS/Linux (redacted by default)
scripts/collect-diagnostics.sh

# Include DB hash metadata
scripts/collect-diagnostics.sh --include-db

# Raw (no redaction). Use only if support asks:
scripts/collect-diagnostics.sh --raw --yes
```

## What gets collected

Each bundle contains a `diagnostics/` folder with:

- `collected/` – redacted copies of application logs, configuration files and
  the most recent crash report (if one exists).
- `raw/` – present only when `--raw` is requested. It holds unredacted copies
  of the same files for advanced troubleshooting.
- `db/` – present only when `--include-db` is used. Contains `db.meta.json`
  (size and timestamps) and `db.sha256` (hash of the SQLite database). The
  database file itself is never copied.
- `manifest.json` – a record of every file considered (included or skipped)
  with metadata, redaction flags and checksums.
- `checksums.txt` – SHA256 hashes for files under `collected/`, `raw/` (if
  present) and `db/`.
- `system.json` – platform metadata, script version, resolved paths and
  timestamp.
- `README.txt` – summary and safety notes for the generated bundle.

Files are discovered using these defaults (all overridable with flags):

| Platform | Logs directory | Data/config directory | Crash reports |
| --- | --- | --- | --- |
| macOS | `~/Library/Logs/Arklowdun/` | `~/Library/Application Support/com.paula.arklowdun/` | `~/Library/Logs/DiagnosticReports/` |
| Linux | `${XDG_STATE_HOME:-~/.local/state}/Arklowdun/logs/` | `${XDG_DATA_HOME:-~/.local/share}/Arklowdun/` | (stub message only) |
| Windows | `%LOCALAPPDATA%\Arklowdun\Logs\` | `%APPDATA%\Arklowdun\` | (stub message with next steps) |

## Redaction rules

Redacted copies remove or normalise sensitive information:

- Email addresses → `<redacted:email>`
- IPv4/IPv6 addresses → `<redacted:ip>`
- MAC addresses → `<redacted:mac>`
- Home directory prefixes (macOS/Linux `~/`, Windows `C:\Users\…`) → `<home>`
- Absolute paths outside the application’s own data/log roots → `<path>`
- 16+ character hexadecimal tokens (except CrashIDs) → `<redacted:uuid>`
- Values for keys named `api_key`, `token`, `password`, `secret` (case
  insensitive) → `<redacted:secret>`

Relative paths inside the app’s own directories are preserved so stack traces
and file locations remain useful.

Any file larger than 10 MB (override with `ARK_MAX_FILE_MB`) is skipped and the
manifest records the skip reason.

## CLI flags

```
--out DIR       Destination directory for the zip (default: Desktop)
--raw           Include unredacted copies in addition to redacted ones
--include-db    Record database metadata and SHA256 hash (no DB contents)
--data-dir DIR  Override the data/config directory
--logs-dir DIR  Override the logs directory
--bundle-id ID  Override the bundle identifier used for crash reports
--yes           Non-interactive mode; auto-confirm the `--raw` warning
```

Examples:

```bash
# macOS/Linux
scripts/collect-diagnostics.sh
scripts/collect-diagnostics.sh --raw --yes --include-db

# Windows PowerShell
pwsh scripts/collect-diagnostics.ps1 --out C:\\Temp\\Support
```

`--raw` prompts before including unredacted files unless `--yes` is supplied.
If the prompt is declined, the script continues with redacted copies only and
records a warning.

## Inspecting the bundle

Open `manifest.json` to see exactly which files were included, skipped and why.
Every entry lists size, modification time and SHA256 checksums. Use
`checksums.txt` to verify files inside the archive. Platform metadata (platform,
OS version, architecture, resolved paths) lives in `system.json`.

To review the bundle without extracting the zip, use any archive viewer. The
generated file name follows `diagnostics-<YYYYMMDD-HHMMSS>-<short-hash>.zip`
where the short hash is derived from the manifest.

## Sharing with support

After running the script the final line of output prints the absolute path to
the generated zip. Attach that archive to the support email. Because content is
redacted by default it is safe to share, but you should still review the README
and manifest before sending.

If you use `--raw` the README includes an additional warning banner to ensure
the recipient understands that unredacted files are present.
