# Responsive utilities

A small set of layout helpers ensure the shell and feature panes compress cleanly on narrow viewports. They are intentionally minimal so that the main layout styles remain authoritative.

## Breakpoints

- **md (≤900px)** — matches the sidebar collapse threshold and tablet widths.
- **sm (≤600px)** — used for compact phone layouts.

## Available classes

| Utility | Purpose | Notes |
| --- | --- | --- |
| `.hide-md` | Visually hides an element at the md breakpoint and below while leaving it in the accessibility tree. | Used for sidebar labels so the icon-only rail stays screen-reader friendly. |
| `.hide-sm` | Same behaviour as `.hide-md`, but for the sm breakpoint. | Handy for trimming non-essential labels on very small screens. |
| `.stack-md` | Forces a flex container into a column layout at the md breakpoint. | Keep the element a flex container; the utility only adjusts direction/alignments. |
| `.grow-xs` | Allows a flex child to grow and fill available space at the sm breakpoint. | Useful for action buttons that should become full-width on phones. |

Add utilities sparingly—if a screen needs bespoke behaviour, prefer a dedicated component style instead of piling on helpers.
