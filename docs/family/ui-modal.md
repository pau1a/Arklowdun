# Family add member modal

The PR8 milestone introduces a dedicated modal flow for creating family members from the header CTA. The modal lives in `src/features/family/modal/AddMemberModal.ts` and is mounted by `FamilyView` whenever `VITE_ENABLE_FAMILY_EXPANSION` is enabled (no extra modal flag required).

## Launch and lifecycle

- `FamilyShell` exposes a setter on the header CTA; when the feature flag is active the view wires this to `mountAddMemberModal`.
- Opening the modal logs `logUI("INFO", "ui.family.modal.open", {})` and traps focus using the global modal utilities.
- Closing the modal (cancel, Esc, overlay click, or after submission) logs `logUI("INFO", "ui.family.modal.close", {})`, unlocks body scroll, restores focus to the CTA, and resets local state.

## Form structure

The modal is a two-step form:

1. **Basic info** – nickname, full name, and relationship. Validation requires a nickname before advancing.
2. **Optional details** – phone number and email address.

Navigation is keyboard-friendly (`Tab`/`Shift+Tab`, `Enter` to advance/submit, `Esc` to dismiss) and the progress indicator updates (`Step n of 2`). Inputs reuse the shared UI primitives for consistent styling.

## Submission and state integration

- On submit the modal derives `name` from the supplied nickname, calculates `position` from `familyStore.getAll().length`, and immediately seeds an optimistic shell via `familyStore.optimisticCreate` so the grid renders the pending card.
- Persistence runs through `familyRepo.create({ householdId, name, notes, position })` with the trimmed payload, and the resulting row is reconciled through `familyStore.commitCreated` to swap the optimistic placeholder for the real member.
- Successful creates trigger `toast.show({ kind: "success", message: "Member added" })`, emit a `family:memberAdded` event (consumed by the grid to focus/scroll into view), and log a debug entry via `logUI("DEBUG", "ui.family.modal.create_success", { member_id, duration_ms })`.

## Error handling

Errors are normalised via `normalizeError`:

- Duplicate position (`DB_CONSTRAINT_UNIQUE` / `duplicate-position`) → info toast with “Could not save — please try again”.
- Missing-name validation (`MISSING_FIELD` / `missing-nickname`) → inline error plus a generic error toast, with the modal returning to step 1.
- All other failures → generic error toast, details logged to the console, and `logUI("WARN", "ui.family.modal.create_failed", { code, context })` for diagnostics.

## Styling and accessibility

The modal uses the shared overlay (`#modal-root`) with an rgba(0,0,0,0.6) backdrop, 480px dialog width (capped to viewport), 90vh max height, and scrollable body content. Step headings use `<h2>`, the dialog is labelled by `#family-add-member-title`, and the progress paragraph doubles as the `aria-describedby` target for assistive tech.

