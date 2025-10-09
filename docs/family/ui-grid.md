# Family Members Grid (PR6)

PR6 replaces the legacy unordered list with an accessible, responsive grid of
family member cards. The grid fits within the existing family shell introduced
earlier in the rollout and becomes the hand-off point for the upcoming member
drawer (PR7).

## Layout

- The shell still follows a three-row layout (`header`, `banner`, `content`).
- `FamilyGrid` renders inside the shell content area and uses an auto-fill CSS
  grid (`minmax(280px, 1fr)`) to keep card widths consistent while adapting to
  viewport size.
- Cards sit within the shell's neutral content host so we avoid "panel on
  panel" layering while still using shared spacing tokens from PR5.

## Card anatomy

Each entry is a focusable `<button class="family-card">` with:

- Member display name (`nickname` → `fullName` → `name`).
- Optional relationship copy.
- Optional birthday badge, formatted using the localised short month/day
  pattern.

Cards surface hover and `:focus-visible` affordances using the accent colour,
ensuring keyboard users have a clear focus indicator.

## Behaviour

- The grid container exposes `role="list"`; each card is wrapped in a
  `role="listitem"` element containing the focusable button.
- Keyboard traversal relies on the browser’s default button semantics (Tab /
  Shift+Tab) and activation (Enter/Space).
- Selecting a member triggers the injected `onSelect` callback while the grid
  preserves its scroll position. This maintains context when the forthcoming
  drawer opens.
- Focus is restored to the previously active card after updates so store
  refreshes do not strand keyboard users.

## Logging & diagnostics

- Every render emits `ui.family.grid.render` with the member count and, when
  available, the `household_id` so backend traces retain full context.
- Selection fires `ui.family.grid.select` (including `household_id`) and
  mirrors a console diagnostic for parity with backend traces.

## Testing

Automated coverage focuses on:

1. Rendering 200 cards within the 240 ms performance budget (includes baseline
   DOM construction overhead observed in JSDOM).
2. Keyboard activation semantics.
3. Scroll-position restoration on selection.

Refer to `src/features/family/__tests__/FamilyGrid.test.ts` for implementation
details.

## Visual reference

_Screenshot to be captured post-merge once the drawer work lands._

