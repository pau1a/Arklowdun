# Family renewals (PR11)

## Overview

Family renewals extend the member drawer with a dedicated tab for tracking expiring assets (passport, driving licence, photo ID, insurance and pension). The feature stores renewals in `member_renewals`, exposes CRUD IPC commands and provides a debounced autosave UI with reminder controls.

Feature flag: `feature.family.renewals`. When disabled the Renewals tab is hidden, though IPC handlers remain available for parity with internal builds.

## Data model

`member_renewals` was created in PR1 and persists all renewal records. Renewals are scoped to a member and cascade on delete.

```sql
CREATE TABLE IF NOT EXISTS member_renewals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  expires_at INTEGER NOT NULL,
  remind_on_expiry INTEGER NOT NULL DEFAULT 0,
  remind_offset_days INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(member_id) REFERENCES family_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_renewals_house_kind
  ON member_renewals(household_id, kind, expires_at);

CREATE INDEX IF NOT EXISTS idx_member_renewals_member
  ON member_renewals(member_id, expires_at);
```

Notes:

- renewals always belong to a member; household-level records are a follow-up item.
- `expires_at` stores the local-noon epoch to avoid DST drift.
- duplicates are allowed (`member_id`, `kind`, `expires_at` is not unique) for flexibility.
- reminder fields default to `remind_on_expiry = 0`, `remind_offset_days = 30`.

## IPC contract

Commands exposed via Tauri:

```rust
#[tauri::command]
async fn member_renewals_list(household_id: String, member_id: String) -> AppResult<Vec<Renewal>>;

#[tauri::command]
async fn member_renewals_upsert(household_id: String, input: RenewalInput) -> AppResult<Renewal>;

#[tauri::command]
async fn member_renewals_delete(household_id: String, id: String) -> AppResult<()>;
```

Validation rules:

- household scope must match the member or `INVALID_HOUSEHOLD` is returned.
- `kind` must be one of `passport`, `driving_licence`, `photo_id`, `insurance`, `pension`.
- `expires_at` must be in the future, otherwise `RENEWALS/PAST_EXPIRY`.
- `remind_offset_days` is clamped to `0..=365`; server rejects out-of-range values as `RENEWALS/INVALID_OFFSET`.
- ids/member ids are validated as UUIDs (`RENEWALS/BAD_UUID`).
- optional `label` values are trimmed and must be between 1 and 120 characters when provided.

IPC payloads are defined in `src/lib/ipc/contracts` (`RenewalSchema`, `RenewalInputSchema`).

## UI behaviour

- Renewals tab lives inside the Family drawer after Documents and before Finance.
- Table columns: kind selector, optional label, expiry (future-dated), reminder toggle, offset (0–365 days) and delete.
- Add button prepends a draft row with default values; focus starts on the kind selector.
- Editing fields triggers debounced autosave (420 ms) through `familyStore.renewals.upsert`. Success shows a toast and updates the list; failures revert changes and surface error toasts/status messages.
- Reminders disabled ⇒ offset input disabled. When enabled the schedule text reflects `remind_offset_days` (“Remind on expiry” or “Remind N days before”).
- Expired records display a “Past date” badge; renewals due in ≤30 days display “Due soon”.
- Offset edits clamp into range and announce “Offset must be between 0 and 365 days.” via the live region.
- Delete asks for confirmation and uses `familyStore.renewals.delete`, showing a success toast on completion.
- Empty state: “No renewals yet. Add passport, licence, policy or pension.”
- Errors surface in an aria-live status element; the table has `role="grid"` with labelled inputs for accessibility.

## Logging

- UI logs: `ui.family.renewal.list`, `ui.family.renewal.upsert`, `ui.family.renewal.delete` (existing store instrumentation). The drawer also writes toasts to the status live region for SR parity.
- IPC handlers log entry/exit with `family.renewals` scope, durations, ids and error codes at WARN/ERROR for validation failures.

## Testing

- Unit coverage: `family.store.test.ts` exercises renewals list/upsert/delete rollbacks. `TabRenewals.test.ts` verifies sorting, offset clamping and autosave toast flows.
- Playwright scenarios (follow-up) should cover add/edit/delete persistence and error presentation when IPC is mocked to fail.

## Deferred items

- household-level renewals and cross-module linking (bills/policies/events).
- encryption/redaction of renewal metadata (tracked TODO).
- background reminder engine and outbound notifications (explicitly out of scope for PR11).

