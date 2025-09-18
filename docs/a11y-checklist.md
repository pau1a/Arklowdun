# Accessibility checklist

This document records the current accessibility expectations for Arklowdun. It should stay in sync with the runtime implementation and automated tests.

## Landmarks and document structure

- The application shell mounts through `src/layout/Page.ts`, which creates a single `#modal-root` host and a `#search-live` region alongside the main layout.【F:src/layout/Page.ts†L16-L35】
- Navigation lives in an `<aside>` with `aria-label="Primary"` plus an internal `<nav>` element for the primary route links.【F:src/layout/Sidebar.ts†L52-L103】
- Main content renders inside `<main id="view" role="main">` from `src/layout/Content.ts` and is the target of skip/focus management when routing changes.【F:src/layout/Content.ts†L6-L9】
- Footer actions are wrapped in `<footer role="contentinfo">` and expose labelled utility buttons for notifications, diagnostics, and help.【F:src/layout/Footer.ts†L42-L96】

## Headings

- The sidebar brand sets the global `<h1>` for the application. Feature views are responsible for providing meaningful headings inside the main region.

## Focus order and management

- Focusable navigation items follow DOM order: sidebar hub links, sidebar primary links, command palette trigger, main content, and footer utilities.
- Modal dialogs created with `@ui/Modal` capture focus, trap tabbing, and restore focus to the invoker after closing.【F:src/ui/Modal.ts†L1-L140】
- The command palette stores the previously focused element and restores it when the palette closes.【F:src/ui/CommandPalette.ts†L61-L114】

## Skip link

- A skip link is not yet present. This shortcut is tracked and will be added in a future iteration.

## Color and contrast

- UI colors come from shared tokens defined in `src/theme.scss` and enforced by `npm run guard:ui-colors` to prevent stray literals.【F:src/theme.scss†L1-L200】
- New components must pull from these tokens to preserve minimum contrast ratios.

## Reduced motion

- Runtime interactions respect `prefers-reduced-motion`. The command palette avoids smooth scrolling when the media query matches, and any additional animation work should follow the same pattern.【F:src/ui/CommandPalette.ts†L29-L108】

## Keyboard reachability and shortcuts

- All interactive controls are keyboard reachable; labels and `aria-*` attributes expose intent on buttons and links.
- Global shortcuts are normalised in `src/ui/keys.ts`:
  - `⌘K` on macOS / `Ctrl+K` elsewhere opens the command palette.
  - `Esc` closes the topmost modal or palette and restores focus.
  - `[` and `]` are reserved for pane cycling; behaviour is documented but not yet implemented in routing.【F:src/ui/keys.ts†L1-L110】
- Shortcuts ignore native typing contexts (inputs, textareas, contenteditable) unless the command palette is already open.【F:src/ui/keys.ts†L41-L59】

## Modal dialogs

- Every modal created through `@ui/Modal` renders inside the shared `#modal-root`, sets `role="dialog"` with `aria-modal="true"`, traps focus, closes on `Esc`, and restores scroll and focus on exit.【F:src/ui/Modal.ts†L1-L140】
- The command palette is implemented as an accessible dialog with labelled title, help text, and listbox semantics.【F:src/ui/CommandPalette.ts†L38-L164】

## Live regions

- `#search-live` exposes polite status updates for command palette results and error messaging.【F:src/layout/Page.ts†L18-L33】【F:src/ui/CommandPalette.ts†L35-L154】

## Automated accessibility smoke tests

- `npm run test:a11y` launches Playwright, boots the Vite dev server, and runs `axe-core` against the Files (`/#/files`) and Calendar (`/#/calendar`) routes with zero tolerated violations after applying the documented allowlist.【F:package.json†L8-L12】【F:tests/a11y/files.spec.ts†L1-L40】【F:tests/a11y/calendar.spec.ts†L1-L38】
- Axe excludes `.sidebar a.active > span` because the current brand palette (orange on cream) misses 4.5:1 contrast; visual design follow-up will revisit the token values before removing this allowlist.【F:tests/a11y/helpers.ts†L8-L13】

## Reserved shortcuts

- Pane cycling via `[`/`]` is reserved for future work. The keyboard map records the reservation so tests and documentation stay aligned.【F:src/ui/keys.ts†L17-L109】
