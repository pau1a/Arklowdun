# IPC contracts

## PR2 — Family IPC Surface & Error Taxonomy

Updated for PR2 (Oct 2025).

PR2 establishes the interaction layer between the renderer and the Rust backend for the Family domain. It introduces typed Tauri
commands for managing member attachments and renewals, defines the associated payload contracts, enforces validation and
structured errors, and sets out the logging and testing expectations that make the interface durable for subsequent PRs.

### File & module layout

| File | Role |
| --- | --- |
| `src-tauri/src/lib.rs` | Register the six new Family commands inside the Tauri builder. |
| `src-tauri/src/commands_family.rs` | Implement IPC handlers for the attachment and renewal surface. |
| `src-tauri/src/repo_family.rs` | Provide SQLx helpers that execute the attachment and renewal queries. |
| `src-tauri/src/model_family.rs` | Define the canonical Rust payload structs `AttachmentRef` and `RenewalInput`. |
| `src/repos.ts` | Expose renderer-facing adapters under `familyRepo.attachments` and `familyRepo.renewals`. |
| `src/lib/ipc/contracts.ts` | Publish Zod schemas that mirror the Rust payload validation. |
| `tests/family_ipc.rs` | Unit-test each IPC command, including error scenarios. |
| `tests/family_repo.rs` | Exercise repository helpers and database validation guarantees. |
| `src/features/family/family.test.ts` | Validate TypeScript adapters, parsing, and boolean coercion. |

### Command inventory

All six commands return `AppResult<serde_json::Value>`; successful payloads contain the requested attachment or renewal data,
while failures return `{ code, message }` drawn from the canonical taxonomy.

| Command | Parameters | Returns |
| --- | --- | --- |
| `member_attachments_list` | `member_id: string` | `AttachmentRef[]` ordered by `added_at DESC`; empty arrays are success. |
| `member_attachments_add` | `{ household_id: string, member_id: string, root_key: string, relative_path: string, title?: string, mime_hint?: string }` | `AttachmentRef` with generated identifiers. |
| `member_attachments_remove` | `id: string` | `void` (`Ok(())`); missing IDs do not error or touch timestamps. |
| `member_renewals_list` | `{ member_id?: string, household_id?: string }` | `Renewal[]` ordered by `expires_at ASC`; household scope used when `member_id` is omitted. |
| `member_renewals_upsert` | `RenewalInput` | `Renewal` containing the persisted row. |
| `member_renewals_delete` | `id: string` | `void` (`Ok(())`); idempotent without side effects. |

Pagination is not supported in PR2; callers fetch the complete set of attachments or renewals for the requested scope.

### Data contracts

#### `AttachmentRef`

```rust
pub struct AttachmentRef {
    pub id: Uuid,
    pub household_id: String,
    pub member_id: String,
    pub root_key: String,
    pub relative_path: String,
    pub title: Option<String>,
    pub mime_hint: Option<String>,
    pub added_at: i64,
}
```

- IDs are UUIDv4 across attachments and renewals.
- `root_key` must resolve to a valid `VaultRoots` value.
- `relative_path` is NFC-normalised, limited to 255 characters, and rejected if it contains traversal segments (`./` or `../`).
- `Vault::resolve` confirms that the resolved path lives inside the guarded vault base and is not a symlink.
- Optional `mime_hint` values match `^[a-zA-Z0-9._+-]+/[a-zA-Z0-9._+-]+$`.
- Optional titles are capped at 120 UTF-8 characters.
- Paths are unique per `(household_id, root_key, relative_path)`; duplicates trigger `ATTACHMENTS/PATH_CONFLICT`. Schema source: [`docs/family/database.md#member_attachments`](database.md#member_attachments).

#### `RenewalInput`

```rust
pub struct RenewalInput {
    pub id: Option<Uuid>,
    pub household_id: String,
    pub member_id: String,
    pub kind: String,
    pub label: Option<String>,
    pub expires_at: i64,
    pub remind_on_expiry: bool,
    pub remind_offset_days: i64,
    pub updated_at: i64,
}
```

- `kind` accepts only `passport`, `driving_licence`, `photo_id`, `insurance`, or `pension`.
- `remind_offset_days` is clamped to the inclusive range 0–365.
- `expires_at` must be a positive epoch timestamp.
- Optional labels are limited to 100 UTF-8 characters.
- Repository checks enforce that the `member_id` belongs to the supplied `household_id`; mismatches surface `VALIDATION/HOUSEHOLD_MISMATCH`.
- Return type `Renewal` mirrors `RenewalInput` but with `id: Uuid` required and immutable `updated_at` stamped by the backend:

```rust
pub struct Renewal {
    pub id: Uuid,
    pub household_id: String,
    pub member_id: String,
    pub kind: String,
    pub label: Option<String>,
    pub expires_at: i64,
    pub remind_on_expiry: bool,
    pub remind_offset_days: i64,
    pub updated_at: i64,
}
```
- Table definitions originate in [`docs/family/database.md#member_renewals`](database.md#member_renewals).

### Repository layer

Repository helpers share the global `SqlitePool` and wrap writes in transactions to guarantee atomicity.

- `attachments_list(member_id)` returns all attachment rows ordered by `added_at DESC`.
- `attachments_add(AttachmentRef)` invokes `Vault::resolve` before inserting the record and reuses the resolved canonical path.
- `attachments_remove(id)` performs an idempotent delete without erroring on missing rows and leaves existing rows untouched.
- `renewals_list(member_id | household_id)` chooses the correct SQL branch and orders by `expires_at ASC`.
- `renewals_upsert(RenewalInput)` uses `INSERT OR REPLACE` to provide atomic upsert semantics scoped to the household.
- `renewals_delete(id)` performs an idempotent delete without mutating timestamps on surviving rows.

### Error taxonomy

| Domain | Code | Trigger | Renderer copy |
| --- | --- | --- | --- |
| Attachments | `ATTACHMENTS/PATH_CONFLICT` | Attempting to reattach an existing `(household_id, root_key, relative_path)` tuple. | “That file is already linked to this person.” |
| Attachments | `ATTACHMENTS/OUT_OF_VAULT` | Path resolves outside the managed vault scope. | “That file isn’t stored in the allowed vault area.” |
| Attachments | `ATTACHMENTS/SYMLINK_REJECTED` | Guard detects a symbolic link. | “Symbolic links can’t be attached.” |
| Renewals | `RENEWALS/INVALID_KIND` | `kind` not in the accepted enum. | “Renewal type not recognised.” |
| Renewals | `RENEWALS/INVALID_OFFSET` | `remind_offset_days` outside 0–365. | “Reminder offset must be between 0 and 365 days.” |
| Validation | `VALIDATION/HOUSEHOLD_MISMATCH` | `member_id` does not belong to `household_id`. | “Member must belong to this household.” |

Other Family validation codes (`VALIDATION/EMAIL`, `VALIDATION/PHONE`, `VALIDATION/URL`, `VALIDATION/JSON`) remain scoped to the PR1 `family_members_*` surface and are documented in the PR1 section below.

Unhandled errors fall back to `GENERIC/FAIL` with “Something went wrong — please try again.”

### Logging requirements

Every command participates in the structured logging model rolled out in PR3. PR2 stubs the entries so that downstream tests can
assert log presence:

- `DEBUG` on entry with `{ cmd, household_id, member_id }`.
- `INFO` on success with `{ elapsed_ms, row_count }` (row count applies to list operations).
- `WARN` for validation failures that are surfaced to the caller.
- `ERROR` for unexpected panics, constraint failures, or SQL errors. Logs emit to stdout in JSON and to the rotating file sink.
- Example log entry:

```json
{"ts":"2025-10-08T12:34:56Z","level":"INFO","area":"family","cmd":"member_renewals_upsert","household_id":"...","member_id":"...","elapsed_ms":14}
```

### TypeScript layer

```ts
export const familyRepo = {
  attachments: {
    list: (memberId: string) => call<AttachmentRef[]>("member_attachments_list", { memberId }),
    add: (input: AttachmentInput) => call<AttachmentRef>("member_attachments_add", input),
    remove: (id: string) => call<void>("member_attachments_remove", { id }),
  },
  renewals: {
    list: (memberId?: string, householdId?: string) =>
      call<Renewal[]>("member_renewals_list", { memberId, householdId }),
    upsert: (input: RenewalInput) => call<Renewal>("member_renewals_upsert", input),
    delete: (id: string) => call<void>("member_renewals_delete", { id }),
  },
};
```

Corresponding Zod schemas in `src/lib/ipc/contracts.ts` enforce string UUIDs for `id`, maximum lengths for titles and labels, MIME regex validation, and the renewal enum/offset constraints. Key fragments:

```ts
const RenewalKind = z.enum(["passport", "driving_licence", "photo_id", "insurance", "pension"]);

export const RenewalInput = z.object({
  id: z.string().uuid().optional(),
  household_id: z.string(),
  member_id: z.string(),
  kind: RenewalKind,
  label: z.string().max(100).optional(),
  expires_at: z.number().positive(),
  remind_on_expiry: z.boolean(),
  remind_offset_days: z.number().int().min(0).max(365),
  updated_at: z.number(),
});
```

`familyRepo.list` expands its return shape to include `attachments` and `renewals`, and a `notes.listByMember` helper scopes note
queries by `member_id`.

### Validation strategy

| Layer | Mechanism | Scope |
| --- | --- | --- |
| Renderer | Zod schemas | Immediate user input validation; adapters emit camelCase keys. |
| IPC | Tauri `invoke` deserialisation | Accepts both `camelCase` and `snake_case` payload keys and normalises before hitting Rust. |
| Rust | Manual checks | Business rules (vault guards, enums, ranges). |
| Database | UNIQUE/FK constraints | Final integrity guard, including household/member matching. |

### Tests & rollout expectations

- `tests/family_ipc.rs` covers success and error paths for each command, asserting `ATTACHMENTS/OUT_OF_VAULT`, `ATTACHMENTS/SYMLINK_REJECTED`, `ATTACHMENTS/PATH_CONFLICT`, `RENEWALS/INVALID_KIND`, `RENEWALS/INVALID_OFFSET`, `VALIDATION/HOUSEHOLD_MISMATCH`, and a representative `GENERIC/FAIL` branch.
- `tests/family_repo.rs` ensures FK cascades, idempotency, and vault guard behaviour.
- `src/features/family/family.test.ts` validates adapter behaviour, JSON parsing, and boolean coercion.
- Minimum coverage for the new surface is ≥ 90 % of introduced lines and the suite must run clean with no skipped tests.
- Manual rollout checklist: commands registered, invalid MIME rejected, logs visible in debug builds, and renderer adapters wired
through the dev console (`await invoke("member_attachments_list", { memberId })`).

## Existing PR1 command surface

### Registered commands
The `gen_domain_cmds!` macro in `src-tauri/src/lib.rs` registers the six PR1 Family endpoints:

| Command | Parameters | Return value |
| --- | --- | --- |
| `family_members_list` | `household_id`, optional `order_by`, `limit`, `offset` | `Vec<serde_json::Value>` rows filtered to the active household |
| `family_members_get` | optional `household_id`, `id` | `Option<serde_json::Value>` for the matching active row |
| `family_members_create` | JSON object (`data`) | Inserted row as a JSON object |
| `family_members_update` | `id`, JSON `data`, optional `household_id` | `()` |
| `family_members_delete` | `household_id`, `id` | `()` |
| `family_members_restore` | `household_id`, `id` | `()` |

Each command is an async Tauri handler that immediately delegates to the shared command helpers without adding logging or tracing statements.

### Behaviour of shared helpers
- `list_command` / `get_command` call `repo::list_active` / `repo::get_active`, guaranteeing `deleted_at IS NULL` and enforcing household scoping and order before converting rows to JSON values.
- `create_command` injects a UUID, fills `created_at`/`updated_at`, validates that every column has a value, and returns the inserted payload. Missing fields trigger `COMMANDS/MISSING_FIELD` with the offending column in the context map.
- `update_command` (not shown above) and `delete_command` call into `repo` to apply partial updates or soft-deletes, while `restore_command` clears `deleted_at` and renumbers positions for ordered tables such as `family_members`.
- SQLx errors are normalised through `AppError::from_sqlx_ref`, which preserves the SQLite constraint name (e.g., the unique `(household_id, position)` index) when present.

### Frontend invocation & error mapping
- The renderer calls these commands via `familyRepo` (`src/repos.ts`), which simply forwards arguments to `call("family_members_*", …)` and expects the full row on create. There is no local caching layer for the Family list.
- The IPC adapter wraps errors with `normalizeError`, standardising `code`, `message`, and optional `context` before rethrowing. No additional UI handling is implemented in `FamilyView`, so errors surface only via rejected promises/console output.
