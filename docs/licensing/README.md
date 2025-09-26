# Licensing NOTICE & CREDITS Automation

This document explains how the automated NOTICE and CREDITS artifacts are generated, verified, and shipped with Arklowdun builds.

## Overview

The licensing pipeline produces a consolidated dependency inventory that feeds the NOTICE/CREDITS generator. Templates under `scripts/licensing/templates` define the published format, and committed outputs live at:

- `NOTICE.md` (repository Markdown copy)
- `CREDITS.md` (repository Markdown copy)
- `src-tauri/resources/licenses/NOTICE.txt` (plaintext bundle resource)
- `src-tauri/resources/licenses/CREDITS.txt` (plaintext bundle resource)

Checksums for the committed artifacts are captured in `artifacts/licensing/notice-checksums.json` to evidence provenance. The Tauri bundler ships the plaintext copies alongside other resources.

## Commands

```bash
# Refresh the licensing inventory and regenerate all NOTICE/CREDITS outputs
npm run generate:notice

# Re-run the generator in verification mode (fails when committed copies drift)
npm run generate:notice -- --check
```

Both commands expect Node.js 20+. The generator reads the most recent `artifacts/licensing/full-inventory.json`; if it is missing, the command will rebuild it automatically.

## Manual Sections & Overrides

Manual appendices (fonts, icons, bespoke attributions) live in `scripts/licensing/notices.yaml` under the `manualSections` key. Each entry specifies the target (`notice`, `credits`, or both), a heading, and content variants for Markdown/plaintext/HTML. Update this file when new bundled assets require explicit notice text.

Package-level metadata corrections continue to live in `scripts/licensing/overrides.yaml`, which feeds the consolidated inventory pipeline.

## Expected Outputs

Successful generation refreshes the four committed NOTICE/CREDITS files and the checksum manifest. CI enforces that these files remain in sync with the dependency inventory; pull requests will fail if any artifact is stale.

The checksum manifest structure:

```json
{
  "inventoryHash": "…",
  "sourceInventory": "artifacts/licensing/full-inventory.json",
  "files": [
    {
      "path": "NOTICE.md",
      "sha256": "…",
      "bytes": 1234
    }
  ]
}
```

The `inventoryHash` is derived from a normalized view of the dependency inventory so that the manifest only changes when the underlying dependency set does.

## Troubleshooting

- **Missing inventory** – Run `npm run licensing:inventory` to recreate `artifacts/licensing/full-inventory.json` and retry.
- **Template rendering errors** – Inspect the template files for unmatched `{{PLACEHOLDER}}` tokens. The generator replaces `{{DEPENDENCY_SECTIONS}}` and `{{MANUAL_SECTIONS}}`.
- **New assets not represented in lockfiles** – Add a manual section in `scripts/licensing/notices.yaml` with explicit attribution text. For recurring issues, consider extending the licensing overrides.
- **CI failure on NOTICE drift** – Run `npm run generate:notice`, review the diff, and commit the updated artifacts alongside dependency changes.
