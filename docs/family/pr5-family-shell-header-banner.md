# Family PR5 – Shell, Header, and Birthday Banner

## Overview
PR5 adds the `FamilyShell` composition layer to the Family view. The shell wraps the future list/drawer/modal content and mounts two new widgets that present immediate household context while reusing the data orchestration delivered in earlier milestones.

## Delivered widgets
- **FamilyHeader**: Displays the household name from `familyStore.meta.householdName`, the number of active members, the next upcoming birthday, and an “Add member” button that will hook into the PR8 modal flow.
- **BannerBirthdays**: Lists up to three birthdays occurring within the next 60 days, ordered by soonest date and then alphabetically. Provides accessible copy such as “Birthday in 12 days.” Shows an empty state when no birthdays meet the window.

## Layout and responsiveness
- The Family route mounts `FamilyShell`, which reserves the top grid rows for the header and banner.
- Above a 960 px breakpoint, the banner occupies the right-hand column beside the header; below that width, it stacks underneath.
- Both widgets subscribe to store updates and recalculate whenever the member list changes.

## Data and computation
- `familyStore` remains the sole data source. No additional IPC endpoints are introduced in PR5.
- Birthday filtering and sorting are handled by a pure helper, `getUpcomingBirthdays(members, days = 60)`, covering leap-year edges and enforcing the three-entry cap.

## Feature flagging
- The entire shell is guarded by the `ENABLE_FAMILY_EXPANSION` flag so release managers can ship the code path ahead of full enablement.

## Testing expectations
- Unit tests cover the birthday utility for ordering, leap-year handling, and the limit of three results.
- Snapshot coverage ensures the header and banner render correctly at desktop and narrow breakpoints, plus the empty state.

## Acceptance criteria
- Header renders household name, member count, and next birthday.
- Banner lists up to three birthdays in the next 60 days, otherwise shows the empty card.
- Disabling the feature flag hides the shell and falls back to the legacy Family list.
