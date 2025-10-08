# IPC extensions (PR2)

PR2 introduces the full backend command surface required for the Family expansion. All commands are exposed through Tauri `invoke` handlers, registered in `src-tauri/src/lib.rs`, implemented in `src-tauri/src/commands_family.rs`, and backed by repository helpers in `src-tauri/src/repo_family.rs`. TypeScript adapters live in `src/repos.ts`.

## New commands
| Command | Request payload | Response payload | Notes |
| --- | --- | --- | --- |
| `member_attachments_list` | `{ household_id: string, member_id: string }` | `{ attachments: AttachmentRef[] }` | Sorted by `added_at DESC`. Returns empty array when no attachments exist. |
| `member_attachments_add` | `{ household_id: string, member_id: string, title?: string, root_key: string, relative_path: string, mime_hint?: string }` | `{ id: string }` | Generates UUIDv4 in Rust. Rejects paths outside the vault guard (see [attachments.md](attachments.md)). |
| `member_attachments_remove` | `{ id: string }` | `{}` | Idempotent: removing a missing attachment succeeds silently. |
| `member_renewals_list` | `{ household_id: string, member_id?: string }` | `{ renewals: Renewal[] }` | When `member_id` omitted, returns all rows in the household ordered by `expires_at ASC`. |
| `member_renewals_upsert` | `{ household_id: string, data: RenewalInput }` | `{ id: string }` | Uses `data.id` when present, otherwise creates a UUIDv4. Updates `updated_at` automatically. |
| `member_renewals_delete` | `{ id: string }` | `{}` | Idempotent delete. |

### TypeScript facades
- `familyRepo.list(householdId)` continues to return `FamilyMember[]`, now including the additive fields documented in [schema_changes.md](schema_changes.md).
- New helpers under `familyRepo.attachments` and `familyRepo.renewals` wrap the commands above and normalise JSON parsing (`*_json` string fields → typed arrays/objects, `keyholder` → boolean).
- `familyRepo.notes.listByMember(memberId)` filters the existing notes list client-side, using the new `member_id` column.

## Data contracts
### AttachmentRef
```ts
interface AttachmentRef {
  id: string
  household_id: string
  member_id: string
  title?: string
  root_key: string
  relative_path: string
  mime_hint?: string
  added_at: number
}
```

### RenewalInput
```ts
interface RenewalInput {
  id?: string
  member_id: string
  kind: string
  label?: string
  expires_at: number
  remind_on_expiry: boolean
  remind_offset_days: number
}
```

- `kind` values accepted: `passport`, `driving_licence`, `photo_id`, `insurance`, `pension`. Additional kinds require updating the renderer allow-list and tests.
- `remind_offset_days` must be `>= 0` and `<= 365`. Enforcement occurs in the Rust layer with a dedicated error.

## Error taxonomy
All commands return structured errors with `code` and `message` fields. The codes below are final and must not change without revisiting release documentation.

| Code | Trigger | HTTP status equivalent |
| --- | --- | --- |
| `ATTACHMENTS/PATH_CONFLICT` | Unique constraint hit on `(household_id, root_key, relative_path)` | 409 |
| `ATTACHMENTS/OUT_OF_VAULT` | Attempt to access a path outside the configured vault root | 403 |
| `ATTACHMENTS/SYMLINK_REJECTED` | Attachment resolves to a symlink when policy forbids it | 400 |
| `RENEWALS/INVALID_KIND` | `kind` not recognised | 400 |
| `RENEWALS/INVALID_OFFSET` | `remind_offset_days` outside `0..365` | 400 |
| `VALIDATION/EMAIL` | `email` column fails validation | 400 |
| `VALIDATION/PHONE` | `phone_*` field fails validation | 400 |
| `VALIDATION/URL` | URL field (website or social link) fails validation | 400 |
| `VALIDATION/JSON` | JSON payload fails to parse or validate | 400 |

Renderer code translates these into user-facing toasts (see [ui_spec.md](ui_spec.md)). Unknown errors fall back to a generic failure toast.

### Error code appendix
Complete list of error identifiers consumed across backend, renderer, and logging:

```
ATTACHMENTS/PATH_CONFLICT
ATTACHMENTS/OUT_OF_VAULT
ATTACHMENTS/SYMLINK_REJECTED
RENEWALS/INVALID_KIND
RENEWALS/INVALID_OFFSET
VALIDATION/EMAIL
VALIDATION/PHONE
VALIDATION/URL
VALIDATION/JSON
```

SQLite constraint errors (e.g., `SQLITE_CONSTRAINT_UNIQUE`) may still bubble up; wrap them with human-readable messages while preserving the original `code` for diagnostics.

## Logging hooks
Every new command participates in the logging strategy defined in [logging_policy.md](logging_policy.md): DEBUG on entry, INFO on success with elapsed milliseconds, WARN on validation rejections, and ERROR on unexpected failures.

## Versioning and compatibility
- The baseline `family_members_*` commands maintain their input/output shape; only the returned `FamilyMember` object grows new optional properties.
- IPC schema versioning remains implicit. The renderer must guard access to new commands behind PR-specific feature flags during development, but by PR3 all commands are unconditional and part of the stable surface.

## Concurrency guarantees
- Attachment add/remove operations run within a transaction per command, ensuring consistent vault updates.
- Renewals upsert uses `INSERT OR REPLACE` semantics keyed by `id` and `household_id`. Repository helpers ensure we never upsert rows belonging to another household.

## Validation summary
- Email and phone validation happen in both renderer and backend; backend is the final arbiter.
- URL validation ensures schemes are `http` or `https` and that the host is non-empty.
- Offset validation prevents integer overflow by clamping to `0..365` and emitting `RENEWALS/INVALID_OFFSET` when outside the range.

These command contracts remain stable through PR14.
