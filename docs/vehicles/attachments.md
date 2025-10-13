# Vehicles Attachments

### Purpose

Document how vehicle maintenance attachments are stored, validated, and surfaced across the stack.

---

## 1. Table columns and defaults

`vehicle_maintenance` carries the attachment metadata:

- `root_key` – Nullable and forced to `NULL` by `commands::create` / `commands::update` so only the `attachments` vault is used.
- `relative_path` – Optional vault-relative path. The IPC guard normalises slashes, enforces path length limits, and strips empty strings.
- `category` – Defaults to `vehicle_maintenance` and is validated by a `CHECK` constraint shared with other attachment tables.

The combination `(household_id, category, relative_path)` is covered by the partial unique index `vehicle_maintenance_household_category_path_idx`, preventing duplicate attachment slots when a file exists.

---

## 2. Vault guard behaviour

When maintenance IPC mutations run, `resolve_attachment_for_ipc_create` / `resolve_attachment_for_ipc_update` constructs an `AttachmentMutationGuard`:

1. Verifies the request household matches the active household lock.
2. Validates the category (`vehicle_maintenance`) and rejects mismatches.
3. Calls `Vault::resolve` to ensure the path sits under `<vault>/<household>/vehicle_maintenance/…`, rejecting symlinks and parent traversals.
4. Normalises the relative path (folding slashes and applying Unicode NFC) and injects it back into the payload.

On delete the guard removes the resolved file via `fs::remove_file`, ignoring `ENOENT` but surfacing other IO failures. Soft-deleting the row happens afterwards so an attachment can be restored later by clearing `deleted_at`.

---

## 3. Exports and diagnostics

- **Export manifest** – `copy_attachments_and_build_manifests` in `src-tauri/src/export/mod.rs` enumerates `vehicle_maintenance` rows where `root_key = 'attachments'` and writes them to both the exported attachments tree and the `attachments_db_manifest.txt`. Missing files trigger an `export_attachment_missing` warning and a `MISSING` marker in the DB manifest.
- **Diagnostics** – Vehicles attachments do not yet have a dedicated orphan scan. Support tooling relies on the export manifest warning (above) and the general vault repair commands to surface missing files.

---

## 4. UI exposure

The current Vehicles UI does not surface maintenance rows or their attachments. Any attachment operations must therefore be performed via diagnostics/repair tooling until the Maintenance roadmap block ships.

---

**Status:** Vault guard in place; no front-end consumption yet.

**Scope:** Attachment columns, validation, and export interplay for `vehicle_maintenance`.

**File:** `/docs/vehicles/attachments.md`
