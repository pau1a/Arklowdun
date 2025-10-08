# Rollout checklist

This checklist consolidates the acceptance criteria across PR1–PR14. Each item must be ticked before tagging the macOS beta in PR14.

## PR1 – Schema migration
- [ ] `migrations/0027_family_expansion.up.sql` applied successfully on seeded database.
- [ ] Down migration verified to restore PR0 schema.
- [ ] `schema.sql` updated with all new columns/tables/indexes.
- [ ] `family_members` new columns default to `NULL` or documented defaults; no data loss.

## PR2 – IPC extensions
- [ ] All new commands registered in `src-tauri/src/lib.rs`.
- [ ] Repository functions validate payloads and emit documented error codes.
- [ ] TypeScript adapters expose attachments and renewals helpers.
- [ ] End-to-end round-trip of new fields confirmed.

## PR3 – Logging
- [ ] DEBUG entry and INFO exit logs exist for every Family IPC command.
- [ ] WARN logs fire for validation failures with redacted details.
- [ ] UI emits `ui.family.*` logs for load, save, attachments, renewals.
- [ ] Log redaction verified (no full passport numbers, etc.).

## PR4 – Store orchestration
- [ ] `familyStore` caches members, attachments, renewals, and exposes subscription API.
- [ ] Store hydration occurs once per household visit.
- [ ] Optimistic updates reconcile with server responses.

## PR5 – Header & banner
- [ ] Header displays household name, active member count, next birthday.
- [ ] Banner shows up to three upcoming birthdays within 60 days.
- [ ] Feature flag can hide header/banner without code removal.

## PR6 – Members grid
- [ ] Card layout replaces legacy list.
- [ ] Keyboard navigation and scroll behaviour match spec.
- [ ] Ordering remains `position, created_at, id`.

## PR7 – Drawer & tabs
- [ ] Drawer opens per member, preserves list scroll.
- [ ] All tabs render specified fields and validations.
- [ ] Save/Cancel triggers toasts and logging.
- [ ] Audit tab updates `last_verified`/`verified_by` correctly.

## PR8 – Add member modal
- [ ] Modal flow captures minimum data and optional extras.
- [ ] New member card receives focus post-create.
- [ ] Duplicate position error surfaces friendly toast.

## PR9 – Attachments UI
- [ ] Drag/drop add works with vault guard.
- [ ] Open/Reval/Remove actions execute successfully.
- [ ] Error toasts map to attachment error codes.

## PR10 – Notes tab
- [ ] Notes filtered by `member_id` with toggle for household notes.
- [ ] Member deletion moves notes to household scope with suffix.

## PR11 – Renewals tab
- [ ] Add/edit/delete flows persist data via IPC.
- [ ] Offset validation enforced (0–365 days).
- [ ] Reminder engine documented as TODO; no background scheduler runs.

## PR12 – Diagnostics & export
- [ ] Diagnostics payload includes new counters.
- [ ] Export includes Family tables with redacted sensitive fields.
- [ ] Export includes `family_plan_version` metadata and redaction TODO note.

## PR13 – QA & performance
- [ ] Deterministic seed script checked in and runnable.
- [ ] QA walkthrough completed on Intel and Apple Silicon macOS (Monterey–Sonoma).
- [ ] Performance logs show drawer save and list render within target (<25% CPU during 200-card scroll).

## PR14 – Packaging & release
- [ ] `scripts/release-macos.sh` handles codesign and notarisation (document dry-run path).
- [ ] DMG installs and runs on clean macOS machine.
- [ ] About dialog shows version + commit.
- [ ] Release notes document known limitations: no deep links, no background reminders, encryption TODO.

## Outstanding TODOs post-wave
- [ ] Build reminder delivery engine.
- [ ] Implement field-level encryption for sensitive columns.
- [ ] Define diagnostics redaction policy for financial data.
- [ ] Add deep-link support (`#/family/<id>`).
- [ ] Plan migration to make `nickname` mandatory (replace legacy `name`).

All boxes must be checked (or explicitly deferred with stakeholder sign-off) before shipping the Family beta.
