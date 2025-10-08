# Architecture

## Module layout
- **Rust IPC surface:** `src-tauri/src/lib.rs` expands `gen_domain_cmds!` with `family_members`, generating the six IPC entry points that proxy into the shared command helpers.【F:src-tauri/src/lib.rs†L638-L853】
- **Shared command helpers:** `src-tauri/src/commands.rs` handles `list`, `get`, `create`, `update`, `delete`, and `restore`, forwarding into `repo::*` for filtering, inserts, and soft-delete workflows.【F:src-tauri/src/commands.rs†L669-L734】【F:src-tauri/src/commands.rs†L1120-L1138】
- **Repository layer:** `src-tauri/src/repo.rs` provides the `list_active`, `get_active`, `clear_deleted_at`, and `renumber_positions` routines that implement household scoping, deleted filters, and stable ordering.【F:src-tauri/src/repo.rs†L165-L205】【F:src-tauri/src/repo.rs†L220-L260】【F:src-tauri/src/repo.rs†L300-L339】【F:src-tauri/src/repo.rs†L450-L506】
- **TypeScript repo:** `familyRepo` in `src/repos.ts` is the only exported client for the module and is consumed solely by the legacy `FamilyView` wrapper.【F:src/repos.ts†L32-L107】【F:src/ui/views/familyView.ts†L1-L4】【F:src/ui/views/index.ts†L1-L16】
- **UI layer:** `src/FamilyView.ts` mounts the page, renders the list/profile states, and calls `familyRepo` directly. No other view imports this module aside from the router plumbing (`mountFamilyView`).【F:src/FamilyView.ts†L20-L148】【F:src/routes.ts†L1-L260】【5403e3†L1-L11】

## Data flow
```mermaid
flowchart LR
  subgraph Renderer
    View[FamilyView.ts]
    RepoTS[familyRepo (repos.ts)]
  end
  subgraph Backend
    IPC[family_members_* commands]
    Cmd[commands.rs helpers]
    RepoRust[repo.rs]
  end
  DB[(SQLite family_members table)]

  View --> RepoTS
  RepoTS --> IPC
  IPC --> Cmd
  Cmd --> RepoRust
  RepoRust --> DB
  DB --> RepoRust
  RepoRust --> Cmd
  Cmd --> IPC
  IPC --> RepoTS
  RepoTS --> View
```

The renderer issues list/create/update calls through `familyRepo`, which invokes the IPC commands via the generic `call` wrapper. Those commands enter the Rust helpers that enforce household scoping, soft-delete filters, and ordering before executing SQL against `family_members` via `repo.rs` and SQLite.【F:src/FamilyView.ts†L27-L145】【F:src/repos.ts†L32-L107】【F:src/lib/ipc/call.ts†L26-L110】【F:src-tauri/src/lib.rs†L638-L853】【F:src-tauri/src/commands.rs†L669-L734】【F:src-tauri/src/repo.rs†L165-L339】

## Layout & navigation integration
- The view is mounted through `wrapLegacyView(FamilyView)` and registered under the hidden navigation pane with route ID `family`, hash `#/family`, and legacy alias `#family`. The router does not lazy-load the module; it is part of the main bundle imports.【F:src/ui/views/familyView.ts†L1-L4】【F:src/routes.ts†L1-L260】
- Application layout creates the shared `#page-banner` host and injects the Family banner image when navigating to the route. `bannerFor` maps `/src/assets/banners/family/family.png` and `updatePageBanner` toggles visibility/ARIA state on every route change.【F:src/layout/Page.ts†L24-L53】【F:src/main.ts†L420-L460】【F:src/ui/banner.ts†L1-L18】【ee8b46†L1-L1】
- No other modules import Family code directly; references are limited to the view wrapper, re-export hub, and router registration confirmed by the repository-wide search output.【5403e3†L1-L11】
