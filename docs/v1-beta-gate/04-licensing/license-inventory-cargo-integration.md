# License Inventory Pipeline – Cargo Integration & Cross-Ecosystem Coverage

[← Back to the licensing & compliance overview](./licensing-compliance-overview.md)

## Objective
Extend the license inventory pipeline to ingest `src-tauri/Cargo.lock`, merge Rust dependency data with the existing npm inventory, and generate a unified artifact that accurately represents all third-party components shipped with the application.

## Current state
* Only the npm extraction (planned in the foundation workstream) exists; Rust dependencies are not inventoried.
* There is no mechanism to detect conflicts or duplicates between ecosystems (e.g., shared libraries with different license metadata).

## Inputs and references
* `src-tauri/Cargo.lock` describing the Rust dependency graph.
* Cargo metadata via `cargo metadata` for supplemental fields (e.g., repository, description, license file).
* Output schema defined in the foundation specification.

## Detailed specification
1. **Implement Cargo lockfile parser.**
   * Create a Rust or TypeScript module capable of parsing `Cargo.lock` including workspaces and patch sections.
   * Capture package name, version, source (registry/git), checksum, license, and features.
   * Detect crates with multiple license expressions and split into SPDX components.
2. **Augment schema coverage.**
   * Ensure the shared schema can represent Rust-specific fields (crate features, source registry).
   * Update schema documentation and validation logic if additional fields are introduced.
3. **Merge npm and Cargo inventories.**
   * Build a consolidation step that reads both inventories and produces a combined JSON artifact (e.g., `artifacts/licensing/full-inventory.json`).
   * Deduplicate packages with identical coordinates but sourced from multiple ecosystems (e.g., dual-published libraries) and reconcile license differences with explicit rules.
   * Attach provenance metadata indicating originating ecosystem(s).
4. **Handle overrides and manual annotations.**
   * Introduce an overrides file (YAML/JSON) allowing compliance reviewers to specify canonical license information when upstream metadata is ambiguous.
   * Incorporate override validation into CI to prevent stale entries.
5. **Testing & fixtures.**
   * Create synthetic `Cargo.lock` fixtures capturing workspace members, git dependencies, path dependencies, and crates with missing license data.
   * Add integration tests covering merge logic, ensuring combined inventory remains schema-compliant and contains expected deduped entries.
6. **CI integration.**
   * Update the licensing CI job to execute both npm and Cargo extraction steps, merging outputs and failing on inconsistencies or missing data.
   * Publish combined inventory as an artifact consumed by subsequent NOTICE generation.
7. **Documentation updates.**
   * Expand the licensing pipeline README with instructions for Rust developers, including prerequisite tools (`cargo`, `rustup`).
   * Document override workflow and how to request new entries.

## Deliverables
* Cargo lockfile parser with automated tests.
* Merge utility producing consolidated inventory artifacts.
* Overrides mechanism with documentation and validation.
* CI workflow updated to run the full cross-ecosystem pipeline.

## Acceptance criteria
* Combined inventory includes every dependency present in both lockfiles with accurate license metadata.
* CI fails when either lockfile changes without corresponding inventory updates or when conflicts remain unresolved.
* Overrides are applied deterministically and are traceable via documentation.

## Dependencies & sequencing
* Requires the shared schema and npm extraction from the foundation specification.
* Should be completed before NOTICE generation to ensure full coverage.

## Risks & mitigations
* **Risk:** License conflicts between ecosystems (e.g., crate vs. npm package differing).
  * **Mitigation:** Flag discrepancies with actionable error messages and require manual review before passing CI.
* **Risk:** Git or path dependencies lacking license metadata.
  * **Mitigation:** Add fallback scanning (e.g., reading LICENSE files) or require manual overrides before merging.

