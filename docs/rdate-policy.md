# RDATE Support Policy

## Definition

`RDATE` is the **Recurrence Date** property defined in [RFC 5545, section 3.8.5.2](https://datatracker.ietf.org/doc/html/rfc5545#section-3.8.5.2).
It allows calendar producers to append explicit date or date-time instances to a recurring series outside of the `RRULE` pattern.
The property accepts multiple value types (DATE, DATE-TIME, PERIOD) and inherits timezone or UTC rules from its context.

## v1 Scope Stance

Arklowdun **does not implement or expose `RDATE` handling in v1**.
The recurrence expansion engine, IPC surface, and test fixtures ignore inbound `RDATE` data.
Contributors must **not** rely on implicit support—the feature is intentionally excluded and **not covered by automated tests**.
Any work that introduces `RDATE` logic must be deferred to a post-v1 milestone.

## Rationale for Exclusion

- **Implementation complexity:** Supporting all three `RDATE` value forms requires parser extensions, storage changes, and IPC shape updates.
- **Low immediate need:** Current product requirements revolve around rule-based recurrences (`RRULE`) and exclusion dates (`EXDATE`); no tracked user stories demand manual inclusions.
- **Resource prioritisation:** Engineering effort is focused on stabilising the v1 beta gate items (RRULE matrix, EXDATE path, timezone correctness). Diverting cycles to `RDATE` would slip those commitments.

## Future Considerations

When `RDATE` becomes a priority, plan dedicated work that includes:

1. **Focused design + implementation PRs** that add parser/storage support and document behavioural expectations.
2. **Expanded recurrence matrix coverage** with scenarios mirroring manual inclusions and timezone edge cases.
3. **Migration planning** for persisted data, including snapshot updates and forward/backfill strategies.
4. **QA instrumentation** (matrix tests, manual checklists) to exercise combinations with `EXDATE`, truncation caps, and IPC consumers.

Until that roadmap is approved, any mention of `RDATE` in issues, PRs, or code comments should link back to this policy to avoid ambiguity about v1 scope.
