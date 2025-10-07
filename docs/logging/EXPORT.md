# Logging Export Guide

Status: Draft
Owner: Ged Kelly
Last updated: 2025-10-07

## Audience
Frontend engineers implementing export mechanics and support staff validating exported files.

## Format
* Exported tails use JSON Lines (NDJSON) exclusively.
* Entries remain in the exact order received from `diagnostics_summary`; no re-sorting or deduping occurs.

## File layout
1. **`_meta` line:** JSON object with keys `app_version`, `schema_version`, `os_version`, `exported_at_utc`, and a `filters` summary capturing severity level and selected categories.
2. **Payload lines:** Raw log entries exactly as delivered by the IPC response.
3. **`_checksum` line:** JSON object containing `sha256` (hex digest computed over the payload lines joined by `\n`) and `record_count` (number of payload records).

## Filename pattern
`arklowdun-tail_{appver}_{YYYY-MM-DDTHH-mm-ssZ}_sev-{level}_cats-{comma-list}.jsonl`

## Checksum computation
* Use the Web Crypto API to compute a SHA-256 digest of the UTF-8 encoded payload portion joined with newline (`\n`) separators.
* Exclude the `_meta` and `_checksum` lines from the hash input; include a trailing newline only if present in the payload source.
* Convert the resulting ArrayBuffer to a lowercase hexadecimal string for embedding in the `_checksum` line.

## Post-export UX
* After writing the file, display a toast summarising the export location and presenting the checksum.
* Provide a "Copy" action within the toast so that support staff can quickly place the checksum on the clipboard.

## Support verification steps
1. Open the JSONL file in a text editor to confirm three segments: `_meta`, payload, `_checksum`.
2. Count the payload lines and ensure they match the `record_count` value.
3. Recompute the SHA-256 over the payload portion and confirm the digest matches the `sha256` value.
4. Validate that the filename reflects the captured severity level and categories.

## Related references
* [OVERVIEW](./OVERVIEW.md)
* [SPEC](./SPEC.md)
* [IPC](./IPC.md)
