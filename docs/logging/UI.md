# Logging UI Guide

Status: Draft
Owner: Ged Kelly
Last updated: 2025-10-07

## Audience
Frontend engineers implementing the Logs page presentation and interactive behaviour.

## Layout
* The Logs view adopts the standard application content grid. Sidebar and footer elements remain visible while the main content pane displays the logs.
* A top header row combines the view title with control toggles and the export action. A narrow banner row appears below the header only when backpressure status needs to be communicated.
* The remaining vertical space is devoted to the log table, which scrolls within the pane while keeping controls visible.

## Controls
* **Severity control:** Presented as ordered buttons or a slider that enforces the inclusive-upward model (e.g., choosing `warn` displays `warn` + `error`).
* **Category selection:** Checkboxes or chips generated from distinct `event` values within the current tail. Multiple selections apply OR semantics.
* **Search box:** Client-side substring match operating across rendered text, including timestamp, level, event, and message columns.
* **Time toggle:** Switch between Local (Europe/London) and UTC display instantly without extra IPC calls.
* **Live Tail toggle:** Start polling `diagnostics_summary` every 3–5 seconds while active; stop polling when toggled off or on navigation away.
* **Export button:** Visible at all times to trigger JSONL export per the specification.

## Table structure
* Columns display `timestamp`, `level`, `event`, and `message`. Messages may truncate with ellipsis while preserving access to raw content.
* Row click may open an optional detail surface showing full JSON for the selected line; if implemented, it must not block core interactions.
* Table data is limited to the ~200 line tail returned by the IPC call, so no virtualisation is required. Smooth scrolling and consistent row heights are expected.
* Rows should colour-code the `level` field using shared theme tokens: info = blue, warn = amber, error = red.

## Performance considerations
* Hold all records in memory within the view; re-fetching only occurs via manual refresh or Live Tail polling.
* Client-side filtering and search must execute instantly over the 200-line dataset without noticeable lag.

## Error handling
* IPC failures render a structured error block within the main pane, offering retry without crashing the shell.
* Malformed lines are skipped gracefully and optionally reported through a non-blocking toast or console log.

## Screenshot

> **Screenshot placeholder:** Add `docs/logging/images/logs-view.png` manually to include the updated Logs view capture.

## Related references
* [SPEC](./SPEC.md)
* [IPC](./IPC.md)
* [EXPORT](./EXPORT.md)
