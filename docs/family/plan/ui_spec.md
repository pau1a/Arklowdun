# UI specification (PR4–PR11)

This document defines the renderer architecture and behavioural contracts for the Family redesign. All file paths reference the React/TSX implementation inside `src/ui/family/` unless otherwise noted.

## Component hierarchy
```
FamilyShell (PR5)
└─ Header (PR5)
└─ BannerBirthdays (PR5)
└─ FamilyList (PR6)
   └─ Card (inline component)
└─ FamilyDrawer (PR7)
   ├─ tabs/Personal (PR7)
   ├─ tabs/Finance (PR7)
   ├─ tabs/Documents (PR9)
   ├─ tabs/Notes (PR10)
   ├─ tabs/Renewals (PR11)
   └─ tabs/Audit (PR7)
└─ AddMemberModal (PR8)
```

## State orchestration
- `familyStore` (PR4) owns the canonical household state. It caches `FamilyMember[]`, keeps attachment and renewal maps keyed by `member_id`, and exposes subscription APIs for React components.
- All network operations funnel through `familyRepo` helpers described in [ipc_extensions.md](ipc_extensions.md). Optimistic updates mutate the store first, then reconcile with server responses.
- The store emits typed events (`members:changed`, `attachments:changed`, `renewals:changed`) so tabs can subscribe narrowly.

### `familyStore` API surface
Declared in `src/ui/family/store.ts`.

```ts
familyStore.load(householdId: string): Promise<void>
familyStore.getAll(): FamilyMember[]
familyStore.get(id: string): FamilyMember | undefined
familyStore.upsert(patch: Partial<FamilyMember> & { id: string }): Promise<void>
familyStore.subscribe(listener: () => void): () => void
```

Attachment and renewal helpers live under `familyStore.attachments` and `familyStore.renewals` namespaces with `load`, `list`, `add`, and `remove`/`delete` methods mirroring the IPC commands.

## Layout and styling
- The shell uses CSS grid with three rows: header, banner, content. Desktop width breakpoint at 960px; below that, the banner stacks under the header.
- Cards in `FamilyList` maintain a fixed width of 280px with responsive wrapping. Keyboard focus uses `:focus-visible` outlines.
- Drawer slides in from the right (width 420px) and is dismissible via escape or outside click.

## Header (PR5)
- Displays household name (`familyStore.meta.householdName`), total active members count, and the next upcoming birthday (computed client-side using `birthday` + current date).
- Includes an "Add member" button that opens `AddMemberModal`.

## BannerBirthdays (PR5)
- Renders up to three members with birthdays occurring within the next 60 days (inclusive). Sorting prioritises soonest upcoming, then alphabetical by nickname/name fallback.
- Uses `idx_family_members_house_bday` via the cached dataset; no additional IPC.

## FamilyList (PR6)
- Cards show nickname (fallback `name`), relationship (when provided), and a birthday badge with day/month.
- Clicking or pressing Enter opens the drawer anchored to that member.
- Maintains scroll position when drawer opens/closes.

## FamilyDrawer (PR7)
- Tabbed interface with local state forms for each section. Save/Cancel apply across all tabs simultaneously.
- Save triggers `familyStore.upsert`, which invokes `familyRepo.update` and rehydrates the store on success.
- Errors surface via toast + inline field message. Tab headers display a red dot when any field inside fails validation.

### Tab details
- **Personal**: fields for nickname, full name, relationship, phones, emails, address, website, social links (managed as key/value pairs stored in `social_links_json`).
- **Finance**: bank accounts and pensions presented as editable lists. Each entry maps to the JSON arrays described in [overview.md](overview.md#workstream-overview) and [schema_changes.md](schema_changes.md). Validation ensures account numbers and sort codes are numeric strings, but enforcement remains client-side.
- **Documents** (PR9): lists attachments, exposes drag-and-drop area, and provides buttons for `Open`, `Reveal in Finder`, and `Remove`. Uses `familyRepo.attachments` helpers.
- **Notes** (PR10): renders notes filtered by `member_id` with create/edit/delete inline using existing notes infrastructure.
- **Renewals** (PR11): table of renewal items with kind selector, expiry date picker, toggle for `remind_on_expiry`, and numeric input for offset days.
- **Audit**: read-only history showing `created_at`, `updated_at`, `last_verified`, `verified_by`, and status. The tab derives its data from existing fields—no dedicated audit table or IPC lands in this wave.

## AddMemberModal (PR8)
- Multi-step: Step 1 (Basic info) collects nickname/name/relationship; Step 2 (Optional details) allows phone/email entry.
- On submit, calls `familyRepo.create`, appends to the store, focuses the new card, and scrolls it into view.
- Validation prevents blank nickname/name pair (at least one must be provided).

## Validation rules (shared)
Defined in `validators.ts` (PR7) and reused across UI and backend error mapping.
- Phone numbers must match `^\+?[1-9]\d{6,14}$`.
- Emails must match simplified RFC 5322 regex used elsewhere in the app.
- URLs must start with `http://` or `https://` and contain a valid hostname.
- Expiry dates must be >= current day in epoch milliseconds.
- JSON arrays (`bank_accounts_json`, `pension_details_json`, `tags_json`, `groups_json`) must parse successfully; invalid JSON blocks save with a toast referencing `VALIDATION/JSON` (renderer-only guard).

## Error mapping
Renderer toast messages map one-to-one with the error taxonomy listed in [ipc_extensions.md](ipc_extensions.md#error-code-appendix). Unknown or unexpected errors fall back to a generic "Something went wrong" toast and emit an ERROR log with the raw message.

## Toast catalogue
- Success: "Family member saved", "Attachment added", "Renewal updated", etc.
- Error: Strings map to error codes listed in [ipc_extensions.md](ipc_extensions.md). Unknown errors show "Something went wrong" and log at ERROR level.

## Accessibility considerations
- Drawer trap focus while open; close restores focus to originating card.
- All buttons have `aria-label` text for screen readers.
- Banner birthdays include text alternatives (e.g., "Birthday in 12 days").

## Feature flag strategy
- During development, each PR may guard new UI under `ENABLE_FAMILY_EXPANSION`. The flag lives in `src/config/flags.ts` and is read in `FamilyShell` before mounting feature components.
- The plan assumes the flag defaults to `true` when the sequence completes. Hide-only rollbacks (PR5–PR11) rely on toggling the flag off without altering data.

## Analytics & logging
- UI components emit structured logs defined in [logging_policy.md](logging_policy.md), e.g., `family.ui.load.ms`, `family.ui.save.ms`, `family.ui.attach.add.ms` with payload `{ member_id, ms }`.

This specification must remain consistent with the backend contracts. Deviations require updating all linked documents and revisiting acceptance criteria in [rollout_checklist.md](rollout_checklist.md).
