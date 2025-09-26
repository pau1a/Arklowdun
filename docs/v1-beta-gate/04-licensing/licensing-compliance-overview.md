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

The gate calls for an automated NOTICE/CREDITS bundle, complete attribution for bundled fonts and icons, and a documented copyleft audit so the distribution package satisfies every licensing obligation. None of the supporting machinery is in place yet, so the body of work is predominantly greenfield.

## NOTICE/CREDITS automation

The application depends on sizeable npm and Cargo graphs (`package-lock.json` and `src-tauri/Cargo.lock`) spanning the React/TypeScript frontend, Playwright tooling, Font Awesome assets, and the Rust/Tauri runtime. Meeting the requirement means inventorying licenses across both ecosystems, normalising the metadata, and emitting a single NOTICE artifact (or a pair, if that proves clearer) without manual curation. Because the Tauri bundle currently only ships a diagnostics guide in its resources, the build configuration also has to stage the generated notice file(s) so they ship with every artifact produced in CI. The pipeline should fail builds whenever the notice step drifts out of sync with the lockfiles; the exit condition hinges on ongoing compliance, not a one-off report.

## Font and icon attribution

Font Awesome is imported directly from the vendored npm package, so the notice mechanism must surface the trademark and licensing statements required by the OFL/CC-BY mix, not just a generic MIT summary. The repository also stores Inter variable fonts locally, and their OFL obligations need to be documented and surfaced both in-app and in the accompanying NOTICE. That likely means explicit acknowledgements inside the UI (about dialog, help screen, etc.) with mirrored coverage in the shipped documentation.

## Copyleft audit and documentation

There is no existing `docs/licensing.md` capturing audit findings or distribution procedures, and the gate entry under `docs/v1-beta-gate/04-licensing/` remains a placeholder. The audit must therefore start from scratch: classify each dependency by license, confirm no GPL/LGPL transitive pulls exist, document how binaries satisfy attribution/source-offer obligations, and codify the steps developers follow when dependencies change. The resulting guide belongs at the mandated path and should become part of release sign-off.

## Overall assessment

Delivering the gate requires tooling to extract and validate dependency metadata, build-system integration so the generated notices ship with artifacts, UI and documentation updates to surface attribution, and a sustainable copyleft review process. Until these capabilities exist, the licensing checklist remains effectively untouched.

