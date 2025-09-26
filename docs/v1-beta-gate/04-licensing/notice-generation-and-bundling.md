# Automated NOTICE/CREDITS Generation & Distribution

[← Back to the licensing & compliance overview](./licensing-compliance-overview.md)

## Objective
Transform the unified licensing inventory into human-readable NOTICE/CREDITS artifacts, integrate generation into CI, and ensure the resulting files ship with all distributable bundles produced by Tauri.

## Current state
* No NOTICE or CREDITS files are generated automatically.
* `src-tauri/tauri.conf.json5` currently ships only the diagnostics guide in the bundle resources.
* Release artifacts lack embedded licensing disclosures.

## Inputs and references
* Consolidated licensing inventory artifact produced by the pipeline specifications.
* Template requirements from legal/compliance stakeholders (formatting, language).
* Tauri bundler documentation for including additional resources.

## Detailed specification
1. **Design NOTICE/CREDITS templates.**
   * Define structure: introduction, dependency table, attribution footers, contact information.
   * Support multiple output formats (Markdown for repository, plaintext or HTML for distribution) as required by legal guidance.
   * Include sections for fonts/icons and any manual notices not captured by lockfiles.
2. **Implement generator tooling.**
   * Build a script (TypeScript or Rust) that consumes the consolidated inventory and template definitions.
   * Group dependencies by license, include SPDX identifiers, and render required attribution statements.
   * Handle multi-license packages gracefully (e.g., “MIT OR Apache-2.0”).
   * Allow manual appendices via configuration file for assets not represented in lockfiles.
3. **Add verification step.**
   * Implement diffing logic to compare generated NOTICE output with committed copies (`NOTICE.md`, `CREDITS.md`).
   * Fail CI when differences are detected, prompting regeneration.
   * Provide developer tooling (`npm run generate:notice`) to refresh artifacts locally.
4. **Integrate with Tauri bundle.**
   * Update `src-tauri/tauri.conf.json5` `bundle.resources` to include the generated NOTICE/CREDITS files.
   * Ensure the build pipeline copies artifacts into the appropriate directory (`src-tauri/resources/` or equivalent) before packaging.
5. **Publish CI artifacts.**
   * Configure CI to upload NOTICE/CREDITS outputs for traceability.
   * Store hash/checksum metadata to evidence provenance of distributed files.
6. **Documentation & onboarding.**
   * Document generation commands, required environment variables, and expected outputs in `docs/licensing.md` or a dedicated README.
   * Include troubleshooting steps for common failures (missing overrides, template rendering issues).

## Deliverables
* NOTICE/CREDITS templates and generator implementation.
* Committed NOTICE outputs kept in sync with automation.
* Updated Tauri configuration ensuring distribution bundles contain the generated files.
* CI job enforcing synchronization between lockfiles, inventory, and NOTICE artifacts.

## Acceptance criteria
* Running the generator locally produces deterministic outputs matching the committed NOTICE files.
* CI fails when NOTICE/CREDITS drift from the current dependency inventory.
* Packaged application artifacts contain the NOTICE/CREDITS files alongside existing resources.

## Dependencies & sequencing
* Requires the consolidated inventory (npm + Cargo) to supply dependency metadata.
* Should precede UI attribution work so that text can be shared where possible.

## Risks & mitigations
* **Risk:** NOTICE templates fall out of sync with legal requirements.
  * **Mitigation:** Establish review cadence with legal stakeholders and version templates.
* **Risk:** Packaging step omits files due to build path changes.
  * **Mitigation:** Add automated tests or CI checks verifying resources exist in the final bundle.

