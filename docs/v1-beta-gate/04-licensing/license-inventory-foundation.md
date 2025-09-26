# License Inventory Pipeline – Shared Model & npm Extraction

[← Back to the licensing & compliance overview](./licensing-compliance-overview.md)

## Objective
Design and implement the first iteration of the automated license inventory pipeline that parses `package-lock.json`, normalises dependency metadata into a shared schema, and produces a machine-readable inventory artifact ready for cross-ecosystem consolidation.

## Current state
* No tooling exists to parse lockfiles or consolidate license data.
* CI has no job dedicated to licensing analysis, and there are no fixtures validating parser behaviour.

## Inputs and references
* `package-lock.json` representing the JavaScript dependency tree.
* npm registry metadata (license fields, repository URLs) accessible via lockfile entries.
* Organizational compliance requirements for inventory reporting (fields, format, storage).

## Detailed specification
1. **Define the shared inventory schema.**
   * Enumerate required fields: package name, version, resolved URL, license(s), source location, checksum, dependency type (direct/indirect), and notes.
   * Represent schema as a JSON Schema document stored under `schema/licensing-inventory.schema.json` (or similar agreed path).
   * Include validation rules for multi-license arrays, SPDX identifiers, and fallback text when license metadata is missing.
2. **Implement npm lockfile parser.**
   * Build a CLI or script (Node.js/TypeScript preferred) located under `scripts/licensing/` that reads `package-lock.json`.
   * Extract package metadata, handling nested dependencies and deduplicating on name@version.
   * Resolve license information using lockfile `license` fields; when absent, fetch package metadata (if network access allowed) or flag for manual resolution.
3. **Generate inventory artifact.**
   * Output normalized data to `fixtures/licensing/npm-inventory.json` for testing and to `artifacts/licensing/npm-inventory.json` during CI runs.
   * Ensure output conforms to the shared schema via automated validation.
4. **Add automated tests.**
   * Create representative fixture lockfiles covering single-license, dual-license, missing-license, and deprecated-package scenarios.
   * Implement unit tests verifying parser correctness, deduplication, and schema validation using the fixture data.
5. **Integrate with CI.**
   * Add a CI job (GitHub Actions or existing pipeline) that runs the parser and fails if schema validation or extraction errors occur.
   * Cache results as build artifacts to feed downstream steps.
6. **Document usage.**
   * Provide a README under `scripts/licensing/` describing invocation, expected inputs/outputs, and troubleshooting steps.
   * Update the licensing gate README to reference the new pipeline.

## Deliverables
* Shared inventory schema committed to the repository.
* npm parser script with comprehensive tests and fixtures.
* CI job definition running the parser on every build.
* Documented instructions for developers to run the parser locally.

## Acceptance criteria
* Parser successfully processes the current `package-lock.json` without manual intervention.
* Output inventory validates against the schema and includes every dependency (direct and transitive).
* CI fails when new dependencies lack license metadata or schema rules are violated.

## Dependencies & sequencing
* No prerequisite code, but schema must be stable enough for downstream Cargo integration.

## Risks & mitigations
* **Risk:** Missing or invalid license data from dependencies.
  * **Mitigation:** Emit actionable warnings, provide override mechanism (e.g., allowlist file), and schedule manual remediation tasks.
* **Risk:** Parser performance issues on large graphs.
  * **Mitigation:** Implement streaming processing and caching to avoid redundant work.

