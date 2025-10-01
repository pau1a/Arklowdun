# Recurrence Expansion Limits

To keep `events_list_range` responsive on large datasets, recurrence expansion is now bounded and explicitly signals when results are truncated.

## Hard Limits

- **Per-series expansion:** A single RRULE can contribute at most **500 instances** to a query window. Additional occurrences are skipped.
- **Per-query total:** `events_list_range` returns at most **10,000 instances** across all series and single events.

These caps are enforced during expansion. Results remain sorted by UTC start time, then title, then ID so downstream consumers continue to see deterministic ordering even when the caps are reached.

## Truncation Signalling

Whenever either cap prevents additional instances from being returned, the IPC payload includes `truncated: true` and echoes the total cap via `limit`. Clients receive the data as:

```json
{
  "items": [ /* Event[] */ ],
  "truncated": true,
  "limit": 10000
}
```

The flag is `false` when the full result set fit within the limits. `limit` is always populated so clients can cite the cap even when local filters reduce the currently rendered count. Backwards compatibility is preserved because the `items` array still contains fully hydrated `Event` objects.

## Truncation Banner UX

When `truncated` is `true`, calendar and other recurrence-driven surfaces render the shared `TruncationBanner` primitive above their list content. The component:

- Announces “Only showing the first _N_ events — refine filters to see more.” with the list size formatted using the viewer’s locale.
- Exposes `role="status"` and `aria-live="polite"` so screen readers announce the banner as soon as it appears.
- Ships with a keyboard-focusable “Close” button that hides the banner until the next truncated payload is fetched. A fresh payload (indicated by a new timestamp token) re-enables the message so the truncation state is not missed.
- Collapses automatically when a subsequent fetch returns the full, untruncated dataset.

The primitive lives in `src/ui/TruncationBanner.ts` and is available for any list that needs to surface truncation.

## Operational Notes

- IPC and test helpers expose both the returned items and the truncation flag so automated checks can assert correct signalling.
- Expansion is performed in UTC while respecting each event’s timezone so that ordering remains stable across reruns.
- The caps guard against runaway recurrence definitions and overly broad queries without altering the recurrence matrix itself (handled separately in PR-7).
