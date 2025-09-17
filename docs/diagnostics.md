# Diagnostics & Logging

The diagnostics collectors capture everything an operator needs to triage issues without exposing customer secrets. Every bundle is redacted, offline, and reviewable before it ever leaves a workstation.

- **Always review the archive before sharing.** Redaction replaces sensitive tokens, and the manifest normalises paths to scoped tokens (for example `<app-data>`, `<app-logs>`, `<home>`). Original absolute paths never appear in the bundle. Confirm the bundle contains only the information you intend to share.
- **Databases are never included.** The collectors optionally add `db/db.meta.json` and `db/db.sha256` so support can confirm hashes, but the SQLite file itself is excluded.
- **No network calls.** Diagnostics run entirely on the local machine – they do not upload, fetch, or phone home.

## Redaction rules

Unless `--raw` is supplied (Linux/macOS) or the `--raw` confirmation is accepted (Windows), every collected text file is sanitised. The Python/PowerShell redactors:

- replace e-mail addresses, IPv4/IPv6 addresses, and MAC addresses with `<redacted:…>` tokens;
- mask JSON-style and assignment-style secrets (keys named `api_key`, `token`, `password`, `secret`);
- collapse long hexadecimal tokens to `<redacted:uuid>` (Crash IDs stay intact);
- normalise home directories to `<home>` and strip absolute paths outside the Arklowdun data/log roots, replacing them with `<path>` or `<app-data>` / `<app-logs>` tokens.

`--raw` skips redaction entirely and should only be used when explicitly requested by engineering. `--raw --yes` (macOS/Linux) assumes consent and is required when python3 is not available.

## Tooling overview

| Workflow | What you get | When to use |
| --- | --- | --- |
| **Settings → About and diagnostics → Copy diagnostics summary** | Platform, version, commit hash, active `RUST_LOG` value, and the last 200 log lines. | First-line support. Copy/paste directly into tickets or Slack threads. |
| **`scripts/collect-diagnostics.sh`** (Linux/macOS) | Full redacted bundle (`diagnostics-YYYYMMDD-HHMMSS-<manifest-hash>.zip`). | Operators with shell access. Attach to support cases after review. |
| **`scripts\collect-diagnostics.ps1`** (Windows) | Same bundle format with PowerShell-native redaction. | Windows operators. |

## In-app diagnostics summary

1. Open **Settings → About and diagnostics**.
2. Click **Copy diagnostics summary**. The status line confirms when the text is on your clipboard and shows the most recent payload for verification.
3. Paste the summary into the support ticket or escalation chat. If full logs are required, follow up with the CLI collector bundle.

Example payload (macOS/Linux sample):

```
Platform: linux (x86_64)
App version: 0.1.0
Commit: unknown
RUST_LOG: (not set)
Log file: /workspace/Arklowdun/diagnostics-home/.local/state/Arklowdun/logs/arklowdun.log
Log tail (1 line):
2025-02-11T10:00:00Z INFO arklowdun booting app for diagnostics sample
```

> The summary never includes attachments, configuration files, or databases—just the snapshot listed above.

## CLI collectors

Run the collector that matches your platform from the repository root.

### macOS & Linux

```bash
bash scripts/collect-diagnostics.sh --include-db --yes
```

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\collect-diagnostics.ps1 --include-db --yes
```

The flags accepted by both collectors are stable:

- `--out DIR` – destination directory (defaults to the Desktop, falling back to the current working directory when the Desktop cannot be resolved).
- `--raw` – include unredacted copies of every collected file (explicit confirmation required unless `--yes` is supplied).
- `--include-db` – add `db/db.meta.json` and `db/db.sha256` for the SQLite database (the database file itself is never copied).
- `--data-dir DIR` / `--logs-dir DIR` – override the auto-detected application data or log directories.
- `--bundle-id ID` – override the macOS bundle identifier used when resolving paths.
- `--yes` – run non-interactively (accepts the `--raw` prompt on macOS/Linux and Windows).
- `--help` – print usage.

### Default paths

| Platform | Data directory | Logs directory |
| --- | --- | --- |
| macOS | `~/Library/Application Support/com.paula.arklowdun` (or overridden `--bundle-id`) | `~/Library/Logs/Arklowdun` |
| Windows | `%APPDATA%\Arklowdun` | `%LOCALAPPDATA%\Arklowdun\Logs` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/Arklowdun` | `${XDG_STATE_HOME:-~/.local/state}/Arklowdun/logs` |

The collectors emit the resulting archive to the Desktop by default. When the Desktop is not resolvable (for example on headless servers), they log `Desktop not found; using <cwd>` and drop the zip alongside the script.

### Naming, exit codes, and logging

- Archive naming follows `diagnostics-YYYYMMDD-HHMMSS-<manifest-sha256-prefix>.zip`.
- Exit codes: `0` = success, `1` = completed with warnings (e.g. missing crash report, raw copy failures), `2` = fatal error / bad invocation.
- Log rotation is configured for **5 files at 5 MB each** (see `DEFAULT_LOG_MAX_SIZE_BYTES` and `DEFAULT_LOG_MAX_FILES` in `src-tauri/src/lib.rs`).

## Bundle contents

Every bundle contains the following top-level files and directories:

- `README.txt` – describes the bundle, flags, and redaction rules.
- `manifest.json` – machine-readable index of every file examined.
- `system.json` – platform metadata (bundle ID, app version, OS version, architecture, timestamp, data/log paths, script version).
- `checksums.txt` – SHA-256 checksums for every collected file plus `manifest.json`.
- `collected/` – redacted copies of logs, configuration files, and crash data (`crash/latest.crash.txt` is always present, even if it only reports “not found”).
- `db/` – optional hash metadata when `--include-db` is supplied (`db.meta.json`, `db.sha256`). The SQLite database file is **never** copied.
- `raw/` – only present when `--raw` was requested.

### Manifest schema (real output)

```json
[
  {
    "path": "<app-logs>/arklowdun.log",
    "category": "log",
    "included": true,
    "size_bytes": 71,
    "mtime_iso": "2025-09-17T06:33:17Z",
    "redacted": true,
    "sha256": "9e2738107835f7faf5caed3c7294f516667f753214eb0ff41ed3543c3e95239d"
  },
  {
    "path": "<app-data>/settings.json",
    "category": "config",
    "included": true,
    "size_bytes": 17,
    "mtime_iso": "2025-09-17T06:33:17Z",
    "redacted": true,
    "sha256": "057c817c6a65ba4c95e68d754eaf8323b5714e95d5ecb624049f5afe95e47ba4"
  },
  {
    "path": "N/A",
    "category": "crash",
    "included": false,
    "reason": "not_found",
    "size_bytes": null,
    "mtime_iso": null,
    "redacted": false
  },
  {
    "path": "<app-data>/app.db",
    "category": "db",
    "included": false,
    "reason": "hash_only",
    "size_bytes": 0,
    "mtime_iso": "2025-09-17T06:34:14Z",
    "redacted": false,
    "sha256_raw": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
]
```

Each manifest entry includes:

- `path` – redacted, normalised source path (`<app-logs>`, `<app-data>`, `<home>`, or `<path>` for out-of-scope locations, plus `N/A` when nothing was discovered).
- `category` – `log`, `config`, `crash`, `db`, etc.
- `included` – `true` when the file was collected under `collected/`.
- `reason` – explains why a file was skipped (`not_found`, `exceeds <limit>MB limit`, `redaction_failed`, `hash_only`).
- `size_bytes` / `mtime_iso` – original metadata when available.
- `redacted` – `true` when the collector produced a sanitised copy.
- `sha256` – checksum for the redacted copy.
- `sha256_raw` – present only when `--raw` is active or for hash metadata (`db.sha256`).
- `limit_mb` – set when a file exceeded the size ceiling (default 10 MB, override with `ARK_MAX_FILE_MB`).

### system.json example

```json
{
  "bundle_id": "com.paula.arklowdun",
  "app_version": "0.1.0",
  "platform": "linux",
  "os_version": "Ubuntu 24.04.2 LTS",
  "arch": "x86_64",
  "timestamp_iso": "2025-09-17T06:33:28Z",
  "data_dir": "/workspace/Arklowdun/diagnostics-home/.local/share/Arklowdun",
  "logs_dir": "/workspace/Arklowdun/diagnostics-home/.local/state/Arklowdun/logs",
  "script_version": "1.0.0"
}
```

## Support workflow

1. Run the appropriate collector (`Copy diagnostics` for summaries, CLI for full bundles).
2. Review `manifest.json`, `system.json`, and the redacted files in `collected/`.
3. Confirm `checksums.txt` lists each collected file plus `manifest.json`. (Optional: run `sha256sum -c checksums.txt` or `Get-FileHash`.)
4. Ensure the crash stub (`collected/crash/latest.crash.txt`) is present. If the manifest reports `not_found`, the stub explains which directory was checked.
5. Attach the zip to the support ticket. Include the diagnostics summary in the ticket body so reviewers see the basics immediately.

### Verification checklist

- Expected top-level files: `README.txt`, `manifest.json`, `system.json`, `checksums.txt`.
- Expected directories: `collected/` (with `crash/latest.crash.txt`), optional `logs/`, `config/`, `raw/`, and `db/` depending on flags and source availability.
- Oversized (>10 MB) files appear in `manifest.json` with `included=false` and `reason="exceeds 10MB limit"` unless the size limit is raised.
- When `--include-db` is used, verify that `db/db.meta.json` reports the on-disk path and `db/db.sha256` contains the hash—no `.db` file should be inside the archive.

## Sample bundle (generate locally)

You can generate a reference bundle locally for demos or validation:

```bash
scripts/collect-diagnostics.sh --include-db --yes --out docs/samples
```

This writes a zip like:

```
docs/samples/diagnostics-YYYYMMDD-HHMMSS-<manifest-hash>.zip
```

> Note: sample zips are **not** committed to the repo. They’re ignored by `.gitignore` to keep the repository lean.

## Logging details

- Application logs live in the platform-specific directories listed above.
- Rotation keeps the current log plus four rolled files (5 × 5 MB).
- The diagnostics summary always reads from the active log and trims to the newest 200 lines.

---

For quick access, open **Settings → About and diagnostics** and click **Help → Diagnostics guide** to launch this document in your system viewer.
