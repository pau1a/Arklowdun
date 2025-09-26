# Copyleft Audit Record & Ongoing Procedure

[← Back to the licensing & compliance overview](./licensing-compliance-overview.md)

## Objective
Conduct a comprehensive copyleft audit across all dependencies, capture findings and remediation steps, and establish a repeatable process documented in `docs/licensing.md` for ongoing compliance.

## Current state
* No copyleft audit has been performed or recorded.
* `docs/licensing.md` does not exist; there is no centralized reference for compliance procedures.
* Release process lacks checkpoints to verify copyleft obligations.

## Inputs and references
* Consolidated license inventory including overrides.
* SPDX license data and legal guidance on copyleft triggers (GPL, LGPL, AGPL, MPL, etc.).
* Organizational policy for source distribution and attribution.

## Detailed specification
1. **Define audit scope & methodology.**
   * Document which ecosystems, artifacts, and build outputs are in scope.
   * Establish criteria for classifying licenses as strong/weak copyleft and the actions required for each.
   * Prepare audit templates (spreadsheets or YAML/JSON records) to capture findings.
2. **Perform dependency classification.**
   * Use the consolidated inventory to identify all packages with copyleft or ambiguous licenses.
   * Record obligations per dependency: source availability, attribution text, network use clauses, etc.
   * Flag unknown or custom licenses for legal review.
3. **Assess distribution impact.**
   * Map audited dependencies to application components (frontend bundle, backend services, installer).
   * Determine whether binary redistribution triggers additional obligations (e.g., providing source code, offering written offers).
4. **Plan and document remediation.**
   * For each copyleft-triggering dependency, document mitigation steps (replace, isolate, provide source offer).
   * Track ownership, due dates, and status for remediation tasks.
5. **Author `docs/licensing.md`.**
   * Summarize audit methodology, findings, and remediation outcomes.
   * Include procedures for recurring audits: frequency, responsible roles, required evidence.
   * Provide templates/checklists for future audits and release sign-offs.
6. **Integrate with release workflow.**
   * Update release runbooks to require referencing `docs/licensing.md` and verifying open remediation items are closed.
   * Add CI or checklist automation ensuring the audit record is refreshed when dependencies change (e.g., verifying timestamp or commit hash in audit log).
7. **Evidence storage.**
   * Define where supporting documents (source archives, correspondence) are stored and how they are linked from the audit record.
   * Ensure access controls align with legal/privacy requirements.

## Deliverables
* Completed copyleft audit record with documented findings.
* New `docs/licensing.md` detailing procedures, remediation, and ongoing maintenance expectations.
* Updates to release workflows/checklists enforcing audit verification.

## Acceptance criteria
* All dependencies classified with clear notes on obligations and remediation status.
* `docs/licensing.md` is comprehensive enough for a new team member to repeat the audit without additional context.
* Release process includes explicit gates referencing the audit record.

## Dependencies & sequencing
* Requires consolidated inventory and font/icon manifest to ensure coverage of all third-party assets.
* Should follow NOTICE generation so obligations reference actual distributed artifacts.

## Risks & mitigations
* **Risk:** Legal interpretations vary and delay completion.
  * **Mitigation:** Engage legal stakeholders early, capture open questions within the documentation, and iterate as guidance is received.
* **Risk:** Audit becomes stale as dependencies change.
  * **Mitigation:** Automate reminders and tie audit updates to dependency lockfile changes in CI.

