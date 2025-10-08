# Diagnostics and export updates (PR12)

PR12 augments diagnostics and export tooling so support engineers can evaluate Family data health. This document specifies the counters, payload shape, and redaction requirements.

**WARNING:** Sensitive fields (passport, licence, NHS, NI, tax, bank, pension) remain stored in plaintext until the encryption follow-up; never attach unredacted exports to public tickets.

## Diagnostics (`src-tauri/src/diagnostics.rs`)
Add the following fields to the diagnostics payload under the `family` section:
- `members_total`: count of rows in `family_members` where `deleted_at IS NULL`.
- `attachments_total`: count of rows in `member_attachments`.
- `renewals_total`: count of rows in `member_renewals`.
- `notes_linked_total`: count of rows in `notes` where `member_id IS NOT NULL`.
- `members_stale`: count of active members (`status = 'active'`) where `last_verified` is null or older than 365 days.

Each counter logs alongside the standard diagnostics output and participates in [logging_policy.md](logging_policy.md) when errors occur.

## Export (`src-tauri/src/export/mod.rs`)
- Include `family_members`, `member_attachments`, `member_renewals`, and `notes` (with `member_id`) in the JSON export.
- For sensitive fields, apply redaction:
  - `passport_number`, `driving_licence_number`, `nhs_number`, `national_insurance_number`, `tax_id`: keep last four characters only (prefix with `***`).
  - Phone numbers and email addresses remain full text to aid support.
  - Attachment paths export `root_key` and `relative_path` exactly; no blobs.
- Annotate the export header with `"family_plan_version": "PR0.5"` to indicate alignment with this blueprint.

## Redaction TODO
- Full redaction policy for bank account numbers and pension details is deferred. Document this TODO in the export output as `"TODO_redaction": "Bank and pension details require encryption"` and in [rollout_checklist.md](rollout_checklist.md).

## Testing
- Diagnostics unit test asserts new counters exist and return expected values against seeded data.
- Export integration test checks that redacted fields maintain correct masking (e.g., `***1234`).

These changes do not alter runtime behaviour before PR12. Documentation ensures the implementation matches support expectations.
