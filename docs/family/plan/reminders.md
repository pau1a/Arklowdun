# Renewal reminders (PR11 foundation)

Renewal tracking is stored in the `member_renewals` table introduced in PR1. PR11 adds the renderer surfaces to manage renewal intent; no automated reminder delivery occurs in this wave.

## Data model recap
See [schema_changes.md](schema_changes.md#member_renewals-table) for DDL. Each row captures a single renewal item for one member.

| Field | Type | Description |
| --- | --- | --- |
| `id` | TEXT primary key | UUIDv4 generated client-side or server-side. |
| `household_id` | TEXT | Scopes the renewal to a household. |
| `member_id` | TEXT | Foreign key to `family_members.id`. |
| `kind` | TEXT | Enum-like string; valid values listed below. |
| `label` | TEXT | Optional display text (e.g., "Passport (GB)"). |
| `expires_at` | INTEGER | Epoch ms of expiry date. |
| `remind_on_expiry` | INTEGER (0/1) | Toggle for same-day reminder. |
| `remind_offset_days` | INTEGER | Days before expiry to trigger reminder. |
| `created_at` | INTEGER | Epoch ms when the row was created. |
| `updated_at` | INTEGER | Epoch ms when last modified. |

Valid `kind` values for this release:
- `passport`
- `driving_licence`
- `photo_id`
- `insurance`
- `pension`
- Future-proof: renderer allows custom strings but warns via toast when unrecognised; backend blocks via `RENEWALS/INVALID_KIND`.

## UI behaviour (PR11)
- Renewals appear on the "Renewals" tab in the member drawer (see [ui_spec.md](ui_spec.md#tab-details)).
- Users can add, edit, and delete rows. Edits happen inline with autosave on blur/submit.
- The tab computes the reminder schedule text client-side (e.g., "Remind 30 days before").
- Sorting is ascending by `expires_at`. Past renewals display with a warning icon.

## Reminder engine status
- Storage only. No background jobs, notifications, or integrations fire in PR11.
- The plan documents a **TODO** to build the reminder engine in a future wave. Mention this TODO in [rollout_checklist.md](rollout_checklist.md).

## Validation rules
- `expires_at` must be in the future (>= today). Renderer prevents past dates; backend rejects with `RENEWALS/EXPIRED_DATE` (mapped to `RENEWALS/INVALID_OFFSET` if reused to avoid extra codes).
- `remind_offset_days` range: 0–365. UI clamps values; backend enforces range.
- Combination of `kind`, `member_id`, and `expires_at` may appear multiple times; no uniqueness constraint is imposed.

## Logging
- Saving a renewal logs `ui.family.renewal.save` (INFO) with `{ member_id, id, ms }` on success or WARN on validation failure (see [logging_policy.md](logging_policy.md)).
- Backend emits DEBUG/INFO/WARN/ERROR per standard policy.

## Future considerations (not part of PR11)
- Support recurring reminders or renewal templates.
- Hook reminders into system notifications once cross-platform design exists.
- Allow household-level renewals (no `member_id`). This requires schema adjustments documented in [relationships_future.md](relationships_future.md).
