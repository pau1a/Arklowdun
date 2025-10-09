# Family add member modal

The PR8 milestone introduces a dedicated modal flow for creating family members from the header CTA. The modal lives in `src/features/family/modal/AddMemberModal.ts` and is mounted by `FamilyView` when both `VITE_ENABLE_FAMILY_EXPANSION` and `VITE_ENABLE_FAMILY_ADD_MEMBER_MODAL` are enabled.

## Launch and lifecycle

- `FamilyShell` exposes a setter on the header CTA; when the feature flag is active the view wires this to `mountAddMemberModal`.
- Opening the modal logs `logUI("INFO", "ui.family.modal.open", { event: "family_modal", action: "open" })` and traps focus using the global modal utilities.
- Closing the modal (cancel, Esc, overlay click, or after submission) logs `logUI("INFO", "ui.family.modal.close", { event: "family_modal", action: "close" })`, unlocks body scroll, restores focus to the CTA, and resets local state.

## Form structure

The modal is a two-step form:

1. **Basic info** – nickname, full name, and relationship. Validation requires a nickname before advancing.
2. **Optional details** – phone number and email address.

Navigation is keyboard-friendly (`Tab`/`Shift+Tab`, `Enter` to advance/submit, `Esc` to dismiss) and the progress indicator updates (`Step n of 2`). Inputs reuse the shared UI primitives for consistent styling.

## Submission and state integration

- On submit the modal assembles a `Partial<FamilyMember>` payload, deriving `name` from the supplied nickname and calculating `position` from `familyStore.getAll().length`. Extra fields are held locally for future milestones while the backend schema is expanded.
- The flow delegates persistence to `familyStore.upsert`, inheriting the optimistic update and reconciliation logic.
- Successful creates trigger `toast.show({ kind: "success", message: "Member added" })`, emit a `family:memberAdded` event (consumed by the grid to focus/scroll into view), and log a debug entry via `logUI("DEBUG", "ui.family.modal.create_success", { member_id, duration_ms })`.

## Error handling

Errors are normalised via `normalizeError`:

- Duplicate position (`DB_CONSTRAINT_UNIQUE` / `duplicate-position`) → info toast with “Could not save — please try again”.
- Missing-name validation (`MISSING_FIELD` / `missing-nickname`) → inline error plus a generic error toast, with the modal returning to step 1.
- All other failures → generic error toast, details logged to the console, and `logUI("WARN", "ui.family.modal.create_failed", { code, context })` for diagnostics.

## Styling and accessibility

The modal uses the shared overlay (`#modal-root`) with an rgba(0,0,0,0.6) backdrop, 480px dialog width (capped to viewport), 90vh max height, and scrollable body content. Step headings use `<h2>`, the dialog is labelled by `#family-add-member-title`, and the progress paragraph doubles as the `aria-describedby` target for assistive tech.

