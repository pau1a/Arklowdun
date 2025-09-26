# Licensing & Compliance Work Overview

The licensing gate requires automation and process maturity across six coordinated workstreams before distribution obligations are satisfied. Each workstream is scoped in a dedicated specification linked below.

## Linked specifications
1. **Charter the licensing gate.** Formalize the gate’s purpose, scope, exit criteria, ownership, and review cadence so stakeholders understand the definition of done. ➜ [Licensing Gate Charter Baseline](./licensing-gate-charter.md)
2. **Build the license inventory foundation.** Create the shared data model and npm parser that extracts license metadata and validates it in CI. ➜ [License Inventory Pipeline – Shared Model & npm Extraction](./license-inventory-foundation.md)
3. **Extend coverage with Cargo integration.** Add Rust dependency parsing, merge inventories, and manage overrides for cross-ecosystem accuracy. ➜ [License Inventory Pipeline – Cargo Integration & Cross-Ecosystem Coverage](./license-inventory-cargo-integration.md)
4. **Generate and bundle NOTICE/CREDITS.** Transform the consolidated inventory into distributable NOTICE artifacts and ship them with every Tauri build. ➜ [Automated NOTICE/CREDITS Generation & Distribution](./notice-generation-and-bundling.md)
5. **Surface font and icon attribution.** Inventory visual assets, feed them into NOTICE outputs, and expose required acknowledgements in the UI. ➜ [Font & Icon Attribution Surfaces](./font-and-icon-attribution.md)
6. **Complete the copyleft audit and procedure.** Classify obligations, document remediation, and institutionalize the ongoing audit in `docs/licensing.md`. ➜ [Copyleft Audit Record & Ongoing Procedure](./copyleft-audit-and-procedure.md)

## Gate objective
Delivering this body of work ensures:
* NOTICE/CREDITS files are generated automatically from the authoritative inventory, verified in CI, and bundled with every artifact.
* Attribution for Font Awesome, Inter, and other assets appears in both documentation and in-app surfaces.
* Copyleft impacts are understood, mitigated, and documented with repeatable procedures.

## Current status snapshot
* Tooling to parse lockfiles, consolidate metadata, and generate notices has not been implemented.
* No attribution manifest or UI surface exists for fonts/icons.
* Copyleft audit documentation is absent; the release process lacks a compliance checkpoint.

## Next steps
Refer to each specification to plan execution, track dependencies, and validate acceptance criteria. Progress across all six workstreams is required to meet the licensing gate exit condition.

