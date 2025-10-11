# Pets PR6 Scope

## Summary
- PR6 focuses on tightening attachment security and UX in the Pets medical records flow: every add/edit must sanitize paths, vault guard errors are surfaced with specific messages, image attachments gain thumbnails, and broken links can be repaired in place without reloading the detail view.
- The deliverables include sanitiser enforcement, an IPC-driven thumbnail cache under the app data directory, broken-link detection with a “Fix path” dialog constrained to vault roots, user-friendly toasts, targeted tests, and accompanying documentation updates in the pets docs suite.
- Verification covers unit, IPC, and performance checks, plus an acceptance checklist, scripted QA workflow, risk mitigations, and assigned sign-off roles, indicating the work is scoped and ready to implement within the broader Pets rollout sequence where PR6 owns attachment handling and vault validation.

## Testing
- ⚠️ Tests not run (QA review only).
