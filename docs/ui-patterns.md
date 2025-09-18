# UI State Patterns

This app uses a canonical triad of primitives to represent async state: **Loading → Empty → Error**. Features should compose one of these building blocks instead of bespoke banners or ad-hoc markup.

## Loading

* Use the `createLoading` helper from `@ui/Loading` to show skeleton placeholders.
* Variants are available for block content, list rows, and inline placeholders.
* Avoid animated spinners or `setTimeout` hacks—stick to shimmering skeletons for perceived performance.

## Empty

* When a feature has zero data, render `createEmptyState` from `@ui/EmptyState`.
* Always provide an icon, concise title, and descriptive body copy so the screen never feels blank.
* Supply a call-to-action via the `cta` option (button or link) that guides the user toward the next obvious step.

## Error

* Scope recoverable failures with `createErrorBanner` from `@ui/ErrorBanner`. The banner supports inline dismissal and expandable diagnostic details.
* Escalate non-recoverable or cross-cutting issues to a toast using `toast.show` from `@ui/Toast`.
* Do not resurrect the legacy `#errors` container or custom warning divs—stick to these primitives for consistency and accessibility.

Adhering to this triad keeps flows predictable: start with a skeleton, graduate to data or an informative empty state, and surface any faults through the shared error primitives.
