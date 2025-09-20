# Timezone Context Badge

The timezone context badge surfaces when the schedule metadata for an item
originates in a different timezone than the current application/system
timezone. It provides a compact reminder that a reminder, deadline, or event
should be interpreted in the source timezone instead of the viewer's local
clock.

## Component summary

- Primitive: `createTimezoneBadge(props)` in `src/ui/TimezoneBadge.ts`.
- Renders a pill-shaped badge containing the source timezone label
  (e.g. `America/New_York`).
- Tooltip copy: _"This event is set in {TZ}. Current app timezone is {AppTZ}."_
  appears on hover and keyboard focus.
- Hidden automatically when the event timezone matches the current app/system
  timezone.

## When to show the badge

Display the badge whenever an entity exposes both of the following:

1. A concrete timezone identifier returned by IPC/DB metadata (`tz`,
   `deadline_tz`, `reminder_tz`, etc.).
2. A mismatch between that timezone and the current application/system
   timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

Hide the badge when either value is missing or they match (case-insensitive).
This keeps local-only items visually uncluttered.

### Current integration surfaces

- **Calendar event modal:** Clicking a calendar entry opens the details modal
  with the badge beside the start time when the event was created elsewhere.
- **Notes deadline panel:** Sticky notes that carry a deadline display the badge
  in the “Deadlines” panel when their deadline timezone differs from the app
  timezone.
- **Files reminder detail:** File reminders (e.g., renewal PDFs) show the badge
  above the preview when their reminder timezone is remote.

## Accessibility guidance

- The badge uses a focusable element with `role="note"` and keyboard focus
  support (`tabIndex=0`).
- Tooltip content is injected into `aria-describedby` so screen readers announce
  the timezone explanation on focus.
- The badge exposes an `aria-label` that mirrors the tooltip sentence for
  environments that do not render tooltips.
- Consumers should not remove focusability; doing so prevents screen reader
  users from hearing the timezone context.

## Copy rules

- Badge label: display the timezone identifier verbatim (`Area/City`).
- Tooltip text: `"This event is set in {TZ}. Current app timezone is {AppTZ}."`
  where `{TZ}` is the event timezone and `{AppTZ}` is the resolved application
  timezone.
- Avoid abbreviations (e.g. `EST`) to prevent ambiguity during DST changes.

## Visual style

- Neutral pill background using existing border/panel tokens. The component
  should not introduce new color values; it reuses `--color-border` and
  `--color-panel` for contrast.
- Focus outline uses the accent token to align with other interactive widgets.

## Example workflow

1. User schedules a flight reminder in `America/New_York` while the household
   timezone remains `Europe/London`.
2. Calendar modal, note deadline list, and file reminder detail each render the
   badge showing `America/New_York` with the tooltip text referencing the
   current app timezone.
3. When the household timezone is later changed to `America/New_York`, the
   badge automatically hides because the values now match.
