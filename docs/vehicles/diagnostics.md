# Vehicles Diagnostics & Export

### Purpose

Summarise the telemetry and backup signals that cover Vehicles today.

---

## 1. Diagnostics bundle

`src-tauri/src/diagnostics.rs` includes `"vehicles" => "vehicles"` and `"vehicle_maintenance" => "vehicleMaintenance"` in the `COUNT_SPECS` macro. As a result:

- Household diagnostics bundles list raw counts for both tables with no masking or aggregation.
- Deleted rows are excluded because the spec flags `filter_deleted = true` for both tables.
- These counts flow into the support bundle JSON and appear in the sidebar when Support downloads diagnostics.

There is no Vehicles-specific health probe beyond the generic schema checks (integrity, foreign keys) that run for every table.

---

## 2. Export coverage

The current export pipeline (`src-tauri/src/export/mod.rs`) only dumps a subset of tables (households, events, notes, files index). Vehicles data is therefore absent from `manifest.json` and the JSONL payloads. The only Vehicles-related artefacts copied today are maintenance attachments:

- `copy_attachments_and_build_manifests` enumerates `vehicle_maintenance` attachment references and copies their files into the export folder.
- For each entry the tool records a line in both `attachments_manifest.txt` (present files) and `attachments_db_manifest.txt` (expected files). Missing files log a `export_attachment_missing` warning and produce a `MISSING` row in the DB manifest.

Future roadmap work will need to add vehicle and maintenance tables to the JSONL dump if we want complete offline restores.

---

## 3. Orphan detection

There is no dedicated orphan scan for Vehicles yet. Missing maintenance files surface in two ways:

1. During export, the vault resolver fails to locate the file, triggering the warning described above.
2. During IPC writes, the `AttachmentMutationGuard` rejects paths that fall outside the vault or reference mismatched households.

Support teams must rely on those signals (plus manual vault repair tooling) until a domain-specific orphan audit is built.

---

**Status:** Counts present; data export pending.

**Scope:** Diagnostics bundle contents and export artefacts relevant to Vehicles.

**File:** `/docs/vehicles/diagnostics.md`
