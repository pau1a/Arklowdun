# Licensing Gate Charter

## Overview
This charter defines how the licensing gate operates within the v1 beta release process. It explains the purpose of the gate, the activities that fall inside and outside its remit, and the objective criteria that must be satisfied before a release candidate can advance. The document is written for release managers, licensing specialists, and partner teams that contribute evidence to demonstrate compliance.

## Goal
Ensure every release candidate ships with validated, legally compliant licensing assets so that distribution obligations are fulfilled, downstream consumers receive required notices, and the organization avoids introducing unvetted licensing risk into the product.

## Scope

### In scope
- Maintain an authoritative inventory of first-party and third-party dependencies, including their detected licenses and usage classification (runtime, build, optional).
- Validate that automated NOTICE generation is complete and bundled with the release payload for all supported platforms.
- Confirm copyleft and reciprocal license obligations are met, including source offer mechanics where applicable.
- Review font, icon, and other embedded asset attributions for correctness and inclusion in user-facing documentation.
- Verify that licensing documentation in product and support channels is updated for new or removed components prior to release.

### Out of scope
- Negotiation or interpretation of bespoke legal agreements, such as custom vendor contracts or customer-specific licensing terms.
- Trademark clearance, patent assessments, or export control reviews (owned by legal and security gates).
- Final sign-off on localized documentation that does not involve licensing content changes.
- Tooling maintenance unrelated to licensing data (e.g., general CI performance tuning).

## Exit criteria
All of the following criteria must be satisfied and evidenced before the licensing gate can sign off a release candidate:
- **NOTICE bundle completeness**: Generated NOTICE files for desktop, mobile, and web distributions exist, contain current dependency attributions, and are attached to the release ticket alongside the `notice-generation-and-bundling.md` report snapshot.
- **Dependency inventory accuracy**: The automated inventory export (JSON + human-readable summary) from the licensing data pipeline matches the dependency manifest for the release branch with no unresolved “unknown” license entries. The npm inventory pipeline defined in `scripts/licensing/README.md` must succeed, producing the normalized artifact consumed by downstream integrations. Evidence is the signed-off report defined in `license-inventory-foundation.md` plus the CI artifact from the cargo integration documented in `license-inventory-cargo-integration.md`.
- **Copyleft compliance**: Copyleft audit checklist is complete with green status on redistribution triggers, source offer validation, and derivative notices, leveraging the workflow defined in `copyleft-audit-and-procedure.md`. Attach the signed checklist and diff of any redistributed source bundles.
- **Font and icon attribution**: Attribution matrix generated per `font-and-icon-attribution.md` is up to date and posted in the shared design documentation space with link referenced in the release ticket. UI copy or help center updates have been merged and linked.
- **Documentation alignment**: Release notes and public documentation reference updated licensing information, verified through the documentation readiness checklist stored in the product docs repository.

## Evidence requirements
For each exit criterion, the following artifacts must be archived with the release candidate:
- Link to the automated NOTICE artifact bundle and a checksum verifying contents.
- Dependency inventory export (machine-readable and markdown summary), signed off by the licensing lead.
- Completed copyleft audit checklist with reviewer signature and timestamp.
- Screenshot or export of the attribution matrix with confirmation from design or UX writer.
- Link to merged documentation pull requests containing licensing updates and associated approval records.
- Gate sign-off comment in the release tracker referencing the above artifacts and indicating the date/time of verification.

## Ownership and stakeholders
- **Accountable owner**: Licensing Compliance Lead (currently the Product Compliance team).
- **Supporting roles**:
  - Release Manager: schedules gate checkpoints, ensures artifacts are attached before code freeze.
  - Legal Counsel (Licensing): provides guidance on ambiguous license terms and approves remediation plans.
  - Developer Experience (Tooling): maintains automation scripts, CI jobs, and dashboards referenced by the gate.
  - Design Operations: supplies updated attribution data for fonts, icons, and other embedded assets.
- **Escalation path**: Blockers are escalated by the Licensing Compliance Lead to the Release Steering Committee within one business day. High-risk legal issues are additionally routed to Legal Counsel via the compliance Slack channel and followed up with a ticket in the legal request system. The Release Manager coordinates go/no-go decisions based on the escalation outcome.

## Process flow
1. **Nightly CI checks**: Licensing inventory and NOTICE generation jobs run nightly on the release branch. The `licensing/inventory` workflow executes `scripts/licensing/npm-inventory.ts` against the current `package-lock.json`, validates the schema, and uploads the resulting artifact. Failures notify the compliance Slack channel and create follow-up issues in the licensing tracker.
2. **Pre-freeze review (T-5 business days)**: Licensing Compliance Lead reviews nightly artifacts, confirms dependency deltas, and requests remediation for gaps.
3. **Code freeze validation (T-2 business days)**: Release Manager convenes a checkpoint with compliance, legal counsel, and tooling representatives to verify that all exit criteria artifacts are present. Outstanding items trigger escalation per the path above.
4. **Release candidate certification (T-0)**: Upon final artifact verification, the Licensing Compliance Lead records a sign-off comment in the release tracker referencing evidence links and confirms with the Release Manager that automation passes are green.
5. **Post-release audit (T+5 business days)**: Compliance team validates that distribution channels include the correct NOTICE bundles and that any remediation work items have documented owners.

### Tooling and communication
- **Automation**: GitHub Actions workflows for dependency inventory and NOTICE generation (including the npm pipeline documented in `scripts/licensing/README.md`), Cargo license scanning plugin, custom scripts detailed in the implementation specifications.
- **Dashboards**: Compliance status dashboard in the internal BI tool showing gate readiness indicators.
- **Communication**: `#release-compliance` Slack channel for daily updates, release tracker issues for formal sign-offs, and email summaries to the Release Steering Committee after each checkpoint.

## Review cadence and change management
- **Cadence**: Charter reviewed quarterly during the Release Governance sync, or sooner if tooling/obligations change materially.
- **Participants**: Licensing Compliance Lead (chair), Release Manager, Legal Counsel, and representatives from tooling and design operations.
- **Change tracking**: Updates recorded in the `licensing-gate-charter.md` change log with version tags aligned to the release train. Major changes require sign-off from the Release Steering Committee.

## Cross-references
- [Licensing compliance overview](./licensing-compliance-overview.md)
- [License inventory foundation](./license-inventory-foundation.md)
- [License inventory cargo integration](./license-inventory-cargo-integration.md)
- [Copyleft audit and procedure](./copyleft-audit-and-procedure.md)
- [Font and icon attribution](./font-and-icon-attribution.md)
- [NOTICE generation and bundling](./notice-generation-and-bundling.md)
- [npm license inventory pipeline](../../../scripts/licensing/README.md)

## Appendices
- **Appendix A: Frequently Asked Questions** – _Placeholder for future FAQs once common questions are collected._
- **Appendix B: Glossary** – _Placeholder for definitions of licensing terms and abbreviations._
- **Appendix C: Change log** – _Placeholder to summarize historical updates to this charter in tandem with `licensing-gate-charter.md`._

