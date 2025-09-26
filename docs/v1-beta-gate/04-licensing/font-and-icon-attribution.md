# Font & Icon Attribution Surfaces

[← Back to the licensing & compliance overview](./licensing-compliance-overview.md)

## Objective
Ensure every bundled font and icon asset has complete attribution across generated documentation and in-application UI surfaces, covering Font Awesome, Inter variable fonts, and any other third-party visual assets.

## Current state
* Font Awesome assets are imported through npm but lack explicit attribution in the UI and NOTICE materials.
* Inter variable fonts are stored locally under `src/theme.scss` references without documented licensing statements.
* No single source of truth exists for asset-level attribution requirements.

## Inputs and references
* Asset sources: `src/main.ts`, `src/theme.scss`, and UI components referencing icons/fonts.
* License texts: SIL OFL for Inter, Font Awesome Free License (OFL + CC BY 4.0 for icons), any additional bundled assets.
* UX guidelines for presenting legal text inside the application.

## Detailed specification
1. **Inventory font and icon assets.**
   * Audit codebase for third-party fonts/icons (including SVGs or webfonts bundled under `src/assets/`).
   * Capture metadata: asset name, source package, license, attribution requirements, inclusion path.
   * Store results in a machine-readable manifest (`assets/licensing/attribution.json`).
2. **Update NOTICE generation inputs.**
   * Ensure the manifest feeds into the NOTICE generator so asset attribution appears under a dedicated section.
   * Include mandatory wording from licenses (e.g., Font Awesome trademark statement).
3. **Design in-app attribution surface.**
   * Choose the appropriate UI location (e.g., About dialog, settings screen).
   * Draft copy that satisfies license requirements while matching product tone.
   * Provide mockups or wireframes if necessary for engineering alignment.
4. **Implement UI updates.**
   * Add new UI components or extend existing ones to display attribution text, ensuring accessibility (screen reader support, contrast).
   * Internationalization considerations: make strings localizable if the app supports multiple languages.
5. **Add automated checks.**
   * Introduce linting or build-time validation ensuring the manifest includes entries for every asset import.
   * Consider snapshot tests for UI attribution text to detect accidental removals.
6. **Document maintenance workflow.**
   * Update developer documentation describing how to add new assets, update the manifest, and verify attribution compliance.
   * Include checklist for design/product reviews when introducing new fonts/icons.

## Deliverables
* Asset attribution manifest under version control.
* NOTICE generator updates producing asset-specific sections.
* UI implementation exposing attribution text to end users.
* Tests and documentation ensuring future assets are registered and disclosed.

## Acceptance criteria
* Every third-party font/icon present in the codebase is represented in the manifest with license and attribution details.
* NOTICE/CREDITS output includes accurate, legally required statements for each asset.
* UI surface displays attribution in-app and passes accessibility checks.
* Build fails if new assets are introduced without manifest updates.

## Dependencies & sequencing
* Depends on NOTICE generation tooling to consume manifest data.
* Can proceed in parallel with copyleft documentation once manifest format is defined.

## Risks & mitigations
* **Risk:** Missing assets due to manual manifest updates.
  * **Mitigation:** Automate detection (e.g., static analysis of imports) and enforce via CI.
* **Risk:** UI clutter or poor user experience due to legal copy.
  * **Mitigation:** Collaborate with design to integrate attribution elegantly and provide tooltips or collapsible sections as needed.

