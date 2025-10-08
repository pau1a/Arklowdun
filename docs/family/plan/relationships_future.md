# Future relationship modelling

This document records how the Family schema will accommodate non-member relationships in future releases without conflicting with the PR1–PR14 plan. No changes here are implemented during the current wave.

## Current stance (PR1–PR14)
- Household-level records continue to store `member_id = NULL` in any shared tables (e.g., `notes`).
- All new tables introduced in PR1 (`member_attachments`, `member_renewals`) require a `member_id` and cascade delete with the member.
- `family_members.status` differentiates `active`, `inactive`, and `deceased` members but does not model relationships to external entities.

## Future additions (not in scope yet)
- **Pets, vehicles, bills**: When added, these entities will reference the household via `household_id` and optionally link to a primary member with nullable foreign keys using `ON DELETE SET NULL`.
- **Shared documents**: Introduce `household_attachments` table mirroring `member_attachments` but without `member_id`. This avoids overloading person-specific storage.
- **Relationship graph**: Potential `member_relationships` table with columns `from_member_id`, `to_member_id`, `relationship_type` (e.g., parent, sibling). If introduced, enforce symmetrical entries via application logic.

## Naming and column guidance
- Foreign keys pointing to family members must use the suffix `_member_id` to avoid ambiguity.
- Status fields remain `TEXT` with constrained vocab; expand via allow-list rather than new tables.
- When modelling non-person entities, prefer dedicated tables rather than overloading `family_members`.

## Data migration strategy
- Future migrations will follow the additive-first approach: add nullable columns/ tables, backfill in dedicated PRs, then enforce constraints.
- Avoid renaming or dropping columns added in PR1–PR14 until after a full release cycle.

## Documentation obligations
- Any future relationship work must update this file and cross-link into [schema_changes.md](schema_changes.md) and [rollout_checklist.md](rollout_checklist.md).

By freezing these rules now, later teams can extend Family without conflicting with the blueprint established in PR0.5.
