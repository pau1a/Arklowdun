# Settings: Household Configuration

The household section of the settings panel lets users manage the logical
container that scopes data throughout Arklowdun. The UI is designed to provide
immediate feedback while mirroring the behaviour of the backend invariants.

## Layout

- **Summary helper** – brief copy explaining that changes affect the entire
  application.
- **Create form** – hidden behind a "Create household" button. Opening the form
  reveals:
  - Name input (required).
  - Colour swatch picker (predefined palette plus "no colour").
  - Save/cancel controls.
- **Household list** – cards for each non-deleted household. Every card shows:
  - Colour chip, name, and badges (`Default`, `Active`, `Deleted`).
  - Action buttons:
    - *Set active* (disabled when the row is already active or soft-deleted).
    - *Rename* (opens inline editor with the same controls as the create form).
    - *Delete* (soft delete with confirmation dialog).
    - *Restore* (only visible for deleted rows).
- **Deleted section toggle** – switch to surface soft-deleted households in a
  separate list so they can be restored.
- **Status line** – contextual messaging for loading states, health gate
  warnings, or the currently active household.

## Behaviour

- All commands execute through the IPC adapter (`@lib/ipc/call`); the UI never
  talks directly to Tauri APIs.
- The store refreshes the household list after each mutation so the cards are
  kept in sync with backend state.
- When the backend deletes the active household and returns a fallback id, the
  store updates immediately to the fallback (typically the default household) to
  avoid visual flicker.
- The "Show deleted households" switch mirrors the underlying store flag. The
  deleted section only renders when enabled and when soft-deleted rows exist.
- Errors coming from the backend are mapped to friendly copy:
  - `DEFAULT_UNDELETABLE` → "The default household cannot be deleted."
  - `HOUSEHOLD_NOT_FOUND` → "That household no longer exists."
  - `HOUSEHOLD_DELETED` → "That household is deleted. Restore it first."
- The default household always renders with a disabled "Delete" control and a
  tooltip explaining the guard so users understand why the action is blocked.
- Success and error paths surface toast notifications so users receive feedback
  without leaving the page.

## Accessibility & Styling

- Buttons use the shared button component so keyboard interactions and focus
  styles are consistent.
- Inline forms reuse the input styles from the rest of the settings view.
- Colour swatches expose accessible labels ("Use colour #…" / "Use no colour").
- Badges use uppercase typography with distinctive colours (`Default` muted,
  `Active` accent, `Deleted` danger) to make status obvious at a glance.
