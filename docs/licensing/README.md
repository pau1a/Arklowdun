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

Manual appendices (bespoke legal copy beyond the automated inventory) live in `scripts/licensing/notices.yaml` under the `manualSections` key. Each entry specifies the target (`notice`, `credits`, or both), a heading, and content variants for Markdown/plaintext/HTML. Use manual sections sparingly—fonts, icon sets, and other visual assets now flow through the attribution manifest described below.

## Font & Icon Attribution Manifest

- **Manifest**: `assets/licensing/attribution.json`
- **Validator**: `npm run guard:asset-attribution`

The attribution manifest inventories every bundled font and icon asset together with its source package, license identifiers, and legally required statements. `scripts/licensing/generate-notices.ts` reads the manifest and renders a dedicated "Bundled Fonts & Icons" section via the `{{ASSET_SECTIONS}}` placeholder in each NOTICE/CREDITS template. Update the manifest whenever visual assets are added, removed, or replaced, then regenerate the NOTICE bundle (`npm run generate:notice`).

CI (and `npm run check`) enforce that:

1. Every font file under `src/assets/fonts/` appears in the manifest.
2. Icon files checked into `src/assets/icons/` or `src/assets/vendor/` must have matching manifest entries.
3. Every third-party font/icon import (for example `@fortawesome/fontawesome-free/css/all.min.css`) has a corresponding manifest entry.
4. Manifest paths and consumer references point at real files.
5. Stylesheets (such as `src/theme.scss`) and source modules cannot reference font or icon assets (including `new URL("…svg", import.meta.url)` patterns) unless the manifest inventories them.

Run `npm run guard:asset-attribution` locally to see the same validation that CI performs.

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
- **Template rendering errors** – Inspect the template files for unmatched `{{PLACEHOLDER}}` tokens. The generator replaces `{{DEPENDENCY_SECTIONS}}`, `{{ASSET_SECTIONS}}`, and `{{MANUAL_SECTIONS}}`.
- **New font or icon assets** – Update `assets/licensing/attribution.json`, rerun `npm run guard:asset-attribution`, and regenerate the NOTICE outputs.
- **CI failure on NOTICE drift** – Run `npm run generate:notice`, review the diff, and commit the updated artifacts alongside dependency changes.
