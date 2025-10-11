# Pets IPC & Validation

## Purpose

Pets PR2 replaces the permissive IPC bridge with explicit Zod contracts so the renderer and
Rust backend agree on payload shapes, error codes, and logging semantics without relying on
best-effort parsing. Every Pets command now has a typed request/response schema, the renderer
repos validate inputs before dispatch, and common failure codes are normalised into consistent
user-facing copy.【F:src/lib/ipc/contracts/pets.ts†L1-L158】【F:src/repos.ts†L33-L141】【F:src/lib/ipc/call.ts†L1-L120】

---

## 1. Command inventory

| Domain        | Command            | Description |
| ------------- | ------------------ | ----------- |
| Pets          | `pets_list`        | List active pets for a household ordered by `position, created_at, id`.【F:src/lib/ipc/contracts/pets.ts†L17-L60】 |
|               | `pets_get`         | Fetch a single pet by ID; household scope is optional for legacy callers.【F:src/lib/ipc/contracts/pets.ts†L62-L66】 |
|               | `pets_create`      | Insert a pet row with generated identifiers and timestamps.【F:src/lib/ipc/contracts/pets.ts†L68-L85】 |
|               | `pets_update`      | Patch mutable pet fields; rejects empty updates.【F:src/lib/ipc/contracts/pets.ts†L87-L98】 |
|               | `pets_delete`      | Soft delete a pet and renumber siblings via the shared command helpers.【F:src/repos.ts†L71-L114】【F:src-tauri/src/lib.rs†L657-L735】 |
|               | `pets_restore`     | Clear `deleted_at`, bump position, and renumber siblings.【F:src/repos.ts†L71-L114】 |
| Pet Medical   | `pet_medical_list` | List active medical records for a household with default ordering `date DESC, created_at DESC, id`.【F:src/lib/ipc/contracts/pets.ts†L113-L126】 |
|               | `pet_medical_get`  | Fetch a medical record by ID; household scope optional for tooling.【F:src/lib/ipc/contracts/pets.ts†L126-L128】 |
|               | `pet_medical_create`| Insert a medical record, defaulting `category` to `pet_medical`.【F:src/lib/ipc/contracts/pets.ts†L130-L149】 |
|               | `pet_medical_update`| Patch mutable medical fields with category enforcement.【F:src/lib/ipc/contracts/pets.ts†L151-L167】 |
|               | `pet_medical_delete`| Soft delete a medical record (including attachment metadata).【F:src/repos.ts†L116-L141】 |
|               | `pet_medical_restore`| Restore a soft-deleted medical record.【F:src/repos.ts†L116-L141】 |
| Attachments   | `files_exists`     | Lightweight probe to confirm an attachment is present under the requested vault root. |
|               | `thumbnails_get_or_create` | Generate or reuse a cached thumbnail for a vault-backed attachment. |

All commands are registered through `gen_domain_cmds!` in the Tauri backend so they participate in
shared logging and attachment guards.【F:src-tauri/src/lib.rs†L642-L735】

---

## 2. Request and response contracts

The renderer validates payloads with dedicated schemas from `src/lib/ipc/contracts/pets.ts`
before invoking the IPC bridge. Requests accept both camelCase and snake_case identifiers so
legacy callers remain compatible, while responses guarantee the full set of persisted columns.
Below are the canonical shapes; optional fields may be omitted when not relevant.

### 2.1 `pets_list`
```jsonc
// Request
{
  "householdId": "hh-1",
  "orderBy": "position, created_at, id",
  "limit": 50,
  "offset": 0
}

// Response
[
  {
    "id": "pet-1",
    "household_id": "hh-1",
    "name": "Skye",
    "type": "Dog",
    "position": 0,
    "created_at": 1735771800000,
    "updated_at": 1735771800000,
    "deleted_at": null
  }
]
```

### 2.2 `pets_create`
```jsonc
// Request
{
  "data": {
    "household_id": "hh-1",
    "name": "Skye",
    "type": "Dog",
    "position": 0
  }
}

// Response
{
  "id": "pet-1",
  "household_id": "hh-1",
  "name": "Skye",
  "type": "Dog",
  "position": 0,
  "created_at": 1735771800123,
  "updated_at": 1735771800123,
  "deleted_at": null
}
```

### 2.3 `pets_update`, `pets_delete`, `pets_restore`
```jsonc
// Request (`pets_update`)
{
  "id": "pet-1",
  "householdId": "hh-1",
  "data": {
    "name": "Skye",
    "updated_at": 1735775400456
  }
}

// Response
null
```
`pets_delete` and `pets_restore` share the same response shape and require `id` plus the household
scope.

### 2.4 `pet_medical_create`
```jsonc
// Request
{
  "data": {
    "household_id": "hh-1",
    "pet_id": "pet-1",
    "date": 1735603200000,
    "description": "Vaccination booster",
    "reminder": 1738281600000,
    "relative_path": "pets/skye/booster.pdf"
  }
}

// Response
{
  "id": "med-1",
  "household_id": "hh-1",
  "pet_id": "pet-1",
  "date": 1735603200000,
  "description": "Vaccination booster",
  "reminder": 1738281600000,
  "relative_path": "pets/skye/booster.pdf",
  "category": "pet_medical",
  "created_at": 1735771800999,
  "updated_at": 1735771800999,
  "deleted_at": null,
  "document": null,
  "root_key": null
}
```

Updates, deletes, and restores for medical records mirror the pets variants: they accept
`householdId` + `id` and resolve to `null` on success.

### 2.5 `files_exists`
```jsonc
// Request
{
  "root_key": "attachments",
  "relative_path": "pets/skye/booster.jpg"
}

// Response
{
  "exists": true
}
```

Requests are rejected when the caller attempts traversal (`./`, `../`), reserved filenames, or out-of-vault paths. The renderer still runs `sanitizeRelativePath()` before dispatch so invalid strings are caught inline, but the backend vault guard remains authoritative.

### 2.6 `thumbnails_get_or_create`
```jsonc
// Request
{
  "root_key": "attachments",
  "relative_path": "pets/skye/booster.jpg",
  "max_edge": 160
}

// Response (success)
{
  "ok": true,
  "relative_thumb_path": "attachments/.thumbnails/1f85c8b0-160.jpg"
}

// Response (unsupported file)
{
  "ok": false,
  "code": "UNSUPPORTED"
}
```

When the source file’s modification time exceeds the cached thumbnail, the backend rebuilds the JPEG before returning. The command emits `ui.pets.thumbnail_built` / `_cache_hit` events so diagnostics can distinguish cold renders from cache hits, and the renderer invalidates stale cache entries after a successful Fix Path flow.

---

## 3. Error normalisation

Common persistence errors are mapped to explicit UI copy in the IPC caller so renderer code can
surface friendly messages without inspecting backend payloads.【F:src/lib/ipc/call.ts†L9-L108】

| Code                    | Message                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `INVALID_HOUSEHOLD`     | “No active household selected.”                                              |
| `SQLX/UNIQUE`           | “Duplicate entry detected.”                                                  |
| `SQLX/NOTNULL`          | “Required field missing.”                                                    |
| `PATH_OUT_OF_VAULT`     | “That file isn’t inside the app’s attachments folder.”                       |
| `PATH_SYMLINK_REJECTED` | “Links aren’t allowed. Choose the real file.”                                |
| `FILENAME_INVALID`      | “That name can’t be used. Try letters, numbers, dashes or underscores.”      |
| `ROOT_KEY_NOT_SUPPORTED`| “This location isn’t allowed for Pets documents.”                            |
| `NAME_TOO_LONG`         | “That name is too long for the filesystem.”                                  |
| `APP/UNKNOWN`           | “Unexpected error occurred.”                                                 |

The behaviour is verified by `tests/normalize-error.test.ts` to guard against regressions in the
error taxonomy.【F:tests/normalize-error.test.ts†L1-L53】

---

## 4. Validation artefacts

| Artefact / Command                               | Coverage |
| ------------------------------------------------ | -------- |
| `tests/contracts/ipc-contracts.spec.ts`          | Confirms Pets contracts parse identical payloads across the fake and Tauri adapters.【F:tests/contracts/ipc-contracts.spec.ts†L1-L207】 |
| `tests/contracts/pets-ipc.spec.ts`               | Exercises the typed repos end-to-end through the IPC adapter, covering list/create/update/delete/restore flows for pets and pet medical records.【F:tests/contracts/pets-ipc.spec.ts†L1-L154】 |
| `npm run test:ipc:pets`                          | Convenience script that runs the dedicated Pets IPC suite.【F:package.json†L17-L66】 |
| `tests/normalize-error.test.ts`                  | Proves error-code overrides return the expected UI copy.【F:tests/normalize-error.test.ts†L1-L53】 |

---

## 5. Repository integration

`petsRepo` and `petMedicalRepo` now coerce payloads through the new schemas before dispatch,
ensure no-op updates short-circuit, and clear the search cache after pets mutations so the
command palette remains fresh.【F:src/repos.ts†L33-L141】 Attachment paths are normalised via
`sanitizeRelativePath()` prior to every `pet_medical_create/update` call, mirroring the
backend guard logic so user-facing errors can surface instantly while the vault remains
authoritative on traversal, symlinks, and reserved-name enforcement.

---

**Status:** IPC contract validation complete for Pets PR2.
**Scope:** CRUD commands for `pets` and `pet_medical`, plus shared capability probes and
error-path hardening.
**File:** `/docs/pets/ipc.md`

---
