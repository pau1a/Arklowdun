# Test strategy

This strategy covers automated and manual verification across PR1–PR14. Each PR references the relevant sections here; together they ensure deterministic coverage for the Family expansion.

## PR1 – Schema migration
- **Migration smoke test**: Apply `0027_family_expansion.up.sql` on seeded database and verify row counts before/after match.
- **Down migration test**: Apply down migration and ensure the schema matches PR0 snapshots (no leftover tables/columns).
- **Schema snapshot diff**: Automated check to confirm `src-tauri/src/schema.sql` reflects new columns and tables.

## PR2 – IPC extensions
- **Rust unit tests**: Cover each new command with valid and invalid payloads, asserting error codes (`ATTACHMENTS/OUT_OF_VAULT`, etc.).
- **TypeScript adapter tests**: Ensure JSON fields parse correctly and boolean conversion (`keyholder`) works.

## PR3 – Logging
- **Backend integration test**: Invoke `family_members_update` and assert DEBUG + INFO logs exist with expected fields.
- **Renderer test**: Mock logging transport and confirm `ui.family.drawer.save` fires with `member_id`.

## PR4 – Store orchestration
- **Store tests**: Verify `load`, `get`, `getAll`, `upsert`, and `subscribe` behaviours, including optimistic updates and reconciliation.
- **Regression**: Ensure subscribers are deduplicated and unsubscribing removes listeners.

## PR5 – Header & banner
- **Unit tests**: Validate birthday calculations (including leap year handling) and list truncation to three entries.
- **Visual regression**: Snapshot test for header layout at desktop and narrow widths.

## PR6 – Members grid
- **Rendering test**: Confirm 200-card render completes within performance budget (React testing library + timers).
- **Keyboard navigation test**: Simulate tab/enter interactions opening the drawer.

## PR7 – Drawer & validation
- **Form validation tests**: Cover phone, email, URL, expiry rules in `validators.ts`.
- **Save flow test**: Successful save triggers toast and closes drawer; failed save keeps drawer open with inline error.
- **Audit tab test**: "Mark verified" updates `last_verified` and `verified_by`.

## PR8 – Add member modal
- **Modal flow test**: Step progression, validation for nickname/name requirement, and focus handling after creation.
- **Error handling test**: Simulate duplicate position constraint and ensure user-facing toast appears.

## PR9 – Attachments UI
- **Drag/drop test**: Mock file drop and confirm add command invoked with correct payload.
- **Error mapping test**: Each attachment error code maps to the correct toast message.

## PR10 – Notes tab
- **Filtering test**: Ensure only member-linked notes display by default; toggle reveals household notes.
- **Deletion test**: Deleting a member reassigns notes to household scope with appended suffix.

## PR11 – Renewals tab
- **Sorting test**: Renewals list ordered by `expires_at` ascending.
- **Validation test**: Offsets outside 0–365 trigger UI error and backend error mapping.
- **Autosave test**: Editing a field triggers save after debounce and success toast.

## PR12 – Diagnostics & export
- **Diagnostics counters test**: Validate each counter against seeded data set.
- **Export redaction test**: Export fixture ensures sensitive fields masked.

## PR13 – QA & performance
- **Seed script test**: Running `tools/seed/seed_family.ts` produces deterministic dataset (identical IDs for repeated runs).
- **Performance sniff**: Manual run on Intel and Apple Silicon machines with logging of CPU usage and UI timings.

## PR14 – Packaging
- **Release script test**: Dry-run `scripts/release-macos.sh` to verify codesign/notarise commands run with `--dry-run` flags.
- **Smoke test**: Install DMG on clean macOS VM and ensure Family module loads with new UI components.

## Continuous integration
- Update CI pipelines to run new tests introduced above.
- Ensure linting/formatting covers newly added directories (`src/ui/family/**`).

This test strategy provides the baseline coverage expectations and should be updated only if the implementation deviates from the plan.
