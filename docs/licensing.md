# Copyleft Audit Record & Ongoing Procedure

## Objective and Scope
This document captures the 2025-09-26 copyleft compliance audit for Arklowdun and records the process the team must repeat whenever the dependency graph changes. The scope covers every third-party component that can ship with the product or contribute bundled assets:

- **JavaScript/TypeScript** dependencies resolved from `package-lock.json` (application UI, build chain, end-to-end tooling).
- **Rust/Cargo** dependencies resolved from `src-tauri/Cargo.lock` (desktop runtime, CLI tools, background services).
- **Bundled assets** captured by the licensing asset manifest (`scripts/licensing/validate-asset-attribution.ts`). These assets inherit the licensing posture of the packages listed above.

> **Primary license.** First-party Arklowdun source and binaries ship under the proprietary terms in `LICENSE.txt`. This audit focuses on third-party copyleft obligations layered on top of that baseline license.

Out-of-scope packages (documented but not audited for copyleft triggers) include local fixtures, test-only binaries that are never distributed, and dependencies that cannot be redistributed (e.g., proprietary fonts) because policy forbids bundling them.

## Classification Criteria
Licenses are classified according to the organizational legal policy:

| Classification | License families | Required actions |
| -------------- | ---------------- | ---------------- |
| **Strong copyleft** | GPL-2.0-or-later, GPL-3.0, AGPL-3.0, Affero-style network clauses, single-license LGPL without permissive alternatives | Provide complete corresponding source code (including build scripts) to recipients, include license text, preserve copyright notices, and offer written offers where required. Network clauses demand that SaaS users obtain source on request. |
| **Weak / file-level copyleft** | LGPL (when linking to dynamic/shared libraries or when a permissive dual-license is unavailable), MPL-2.0, EPL-1.0/2.0, CDDL | Provide access to modified source for the covered files, ship license text and notices, and document where the pristine source can be obtained. Dynamic linking to LGPL components requires allowing reverse engineering for debugging. |
| **Dual-licensed with permissive option** | Packages published under `MIT OR Apache-2.0`, or multi-licensed with a permissive choice in addition to copyleft | Elect the permissive option, document the election in the audit record, and satisfy the NOTICE/attribution obligations that accompany the permissive license. |
| **Unknown / custom** | Any SPDX identifier not recognized by policy, or custom terms | Escalate to legal and block release until clarified. |

## Methodology
1. **Generate the consolidated inventory.** Run `npm run licensing:inventory` to emit `artifacts/licensing/{npm,cargo,full}-inventory.json` validated against `schema/licensing-inventory.schema.json`. Record the lockfile digests in the audit log.
2. **Filter for copyleft triggers.** Use `artifacts/licensing/full-inventory.json` to locate packages whose license metadata matches the copyleft families above. Flag unknown SPDX identifiers for legal review.
3. **Map to shipped artifacts.** Determine whether each dependency is linked into the Tauri binary, bundled with the front-end, or only used for tooling/tests. Cross-check `scripts/licensing/validate-asset-attribution.ts` and the NOTICE generator to confirm asset coverage.
4. **Capture obligations and remediation.** For each flagged package, document the distribution obligations, mitigation decisions, assignee, and due date in `docs/licensing/copyleft-audit-record.yaml`.
5. **Store evidence.** Archive upstream source tarballs, correspondence, and remediation proof under `docs/licensing/evidence/` (or the restricted compliance share for private material) and link them from the audit record.
6. **Publish findings.** Update this document with methodology changes, summarize remediation status, and notify legal of any outstanding questions.

## 2025-09 Copyleft Findings Summary
The current audit (inventory commit `d86db9ae2d1e7d6db0737cfd871af29b7c337aba`) identified the following components. Full details, including remediation owners and evidence links, live in `docs/licensing/copyleft-audit-record.yaml`.

| Component | Ecosystem | License(s) | Classification | Distribution impact | Resolution |
| --------- | --------- | ---------- | -------------- | ------------------- | ---------- |
| `@axe-core/playwright` | npm (direct dev) | MPL-2.0 | Weak/file-level | Dev-time accessibility test harness; not shipped in release artifacts. | Documented as non-distributed tooling. No additional action required beyond keeping it out of production bundles. |
| `axe-core` | npm (indirect) | MPL-2.0 | Weak/file-level | Dev-time dependency pulled by `@axe-core/playwright`. | Same as above. |
| `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors` | Cargo (transitive via Tauri/tao) | MPL-2.0 | Weak/file-level | Linked into the desktop binary. | Ship MPL-2.0 license text via NOTICE bundle, track upstream tarball URLs, and re-share modifications if any local patches are applied (none at present). |
| `r-efi` | Cargo (transitive) | MIT, Apache-2.0, LGPL-2.1-or-later | Dual-licensed (permissive elected) | Linked into Windows-specific runtime code. | Elect MIT/Apache-2.0 option; ensure NOTICE includes permissive attribution and record election in audit log. |

No strong copyleft packages or unknown licenses were found. All obligations are satisfied through attribution bundles and adherence to upstream terms. Future modifications to MPL-covered code must be mirrored to recipients.

## Remediation Tracking
See `docs/licensing/copyleft-audit-record.yaml` for structured remediation entries. Outstanding items at the time of this audit:

- Automate regression detection: ✅ Implemented via `npm run guard:copyleft-audit` (see below).
- Evidence staging: ✅ `docs/licensing/evidence/README.md` documents the secure storage convention.
- Legal clarifications: None required; all packages have clear SPDX identifiers.

Any new remediation work must be tracked in the YAML record with an owner, status, and due date.

## Ongoing Maintenance
- **Trigger conditions.** Re-run the audit whenever `package-lock.json`, `src-tauri/Cargo.lock`, bundled asset manifests, or licensing overrides change. At minimum, perform a full review once per quarter.
- **Responsible roles.** The release manager owns execution; legal/compliance reviews unresolved questions; engineering updates the NOTICE pipeline.
- **Required evidence.** Preserve:
  - Inventory JSON snapshots under `artifacts/licensing/`.
  - Source archives or upstream commit hashes for all copyleft dependencies.
  - Email or ticket references approving remediation steps.
- **Templates & checklists.** Use `docs/licensing/templates/copyleft-audit.template.yaml` to start new audits and the release checklist below to confirm compliance before shipping.

## Release Workflow Integration
1. **Automation.** `npm run guard:copyleft-audit` validates that the recorded lockfile hashes in `docs/licensing/copyleft-audit-record.yaml` match the current repository state. The release npm script fails if the audit is stale.
2. **Manual checklist.** During release prep, confirm:
   - The audit record has no open remediation tasks marked `open` or `blocked`.
   - Any MPL/LGPL source mirrors are accessible to recipients.
   - Evidence links in the YAML record resolve.
3. **Runbook updates.** See `docs/release.md` for the explicit gate inserted into the release process.

## Evidence Storage
- **Public evidence.** Place non-sensitive materials (e.g., upstream tarball URLs, hash manifests) under `docs/licensing/evidence/`.
- **Restricted evidence.** Store legal correspondence and private source archives on the compliance SharePoint (folder `Copyleft Evidence/2025-09`) and reference the access path in the YAML record. Access is limited to Legal, Compliance, and the release manager group.

## Next Steps
- Re-run `npm run licensing:inventory` and update the audit record whenever dependency hashes change.
- Engage Legal immediately if future audits encounter custom licenses or GPL/AGPL obligations.
- Keep this document and the YAML record under version control to preserve audit history and enable diff-based reviews.
