# Arklowdun Job List — Sun 14 Sep 2025

> Job List ID: JL-2025-09-14-01  
> This job list follows [JL-2025-09-07-01](docs/job-lists/JL-2025-09-07-01.md).  
> **Policy:** No external CI. All checks are local (scripts, make targets, and git hooks).

## Purpose
Advance v1+1 priorities: Quick Search MVP, About & Diagnostics, and extended local guards. These must be completed in order before subsequent polish items (Notes → Attachments → Backup/Restore).

## Conventions
- Branch naming: `pr/<number>-<short-name>`
- Commit subject prefix: `[PR-XX]`
- Labels: `backend`, `frontend`, `migrations`, `docs`, `ux`, `perf`, `risk`
- PR order is **mandatory** unless explicitly re-approved.

## Local workflow (no external CI)
- Recommended git hook: `.githooks/pre-push` that runs the commands listed under **Global guards**.  
  Enable with: `git config core.hooksPath .githooks`
- Optional wrappers:
  - `make check` → runs static checks + guards
  - `make test` → runs Rust + TS tests
  - `make build` → release build sanity-check

---

## Global guards (must remain true throughout; run locally)

- [ ] Local guard script **blocks JSON domain writes**  
      Run: `bash scripts/ci/no-json-writes.sh` (local guard script; name retained, no external CI implied)
- [ ] No domain JSON reads outside sanctioned file views  
      Run: `git grep -n '@tauri-apps/plugin-fs' -- src | grep -v 'FilesView'` → **no hits**
- [ ] No direct `invoke(` outside the unified helper
      Run: `git grep -n 'invoke\\(' -- src | grep -v 'src/lib/ipc/call.ts'` → **no hits**
- [ ] No `alert(` for error paths in production code  
      Run: `git grep -n 'alert\\(' -- src` → **0** (or dev-only utilities)
- [ ] TypeScript strict passes (no errors)  
      Run: `npm run typecheck` (or `tsc -p tsconfig.json --noEmit`)
- [ ] Rust lints clean  
      Run: `cargo clippy -- -D warnings`
- [ ] Project builds locally  
      Run: `npm run tauri build` (or `npm run tauri dev` sanity-check)
- [ ] Architecture docs present and linked from README

---

## Execution order overview (new)

13. PR-13 Quick Search MVP  
14. PR-14 About & Diagnostics  
15. PR-15 Extended Guards  

---

## PR-13 — Quick Search MVP

**Objective**  
Single omnibox search across files, events, and notes.

**Backend**
- Use `LIKE` queries for now:
  - Files → prefix match on filenames
  - Events → substring match on titles
  - Notes → substring match on text
- Cap results at 100; support offset/limit paging.
- Ranking: title matches outrank body matches.

**Frontend**
- Add omnibox at top of every view.
- Inline results showing context (icon, title, snippet, date).

**Acceptance (local)**
- Searching “rent” matches events and notes.
- ≤100 results initially; “Load more” works.
- Title matches appear above body matches.

---

## PR-14 — About & Diagnostics

**Objective**  
Improve transparency and supportability.

**Backend**
- Embed version, commit hash, build timestamp at build time.

**Frontend**
- About pane: show version, commit hash, timestamp.
- Diagnostics → “Copy diagnostics”:
  - Platform
  - App version
  - Commit
  - RUST_LOG
  - Last 200 log lines

**Logging**
- Rolling log files under `appDataDir/logs`
- 3 files × 1 MB each

**Acceptance (local)**
- About shows all 3 fields.
- Diagnostics copies expected payload.
- Log rotation works.

---

## PR-15 — Extended Guards

**Objective**  
Harden local hygiene.

**Guards**
- Forbid `@tauri-apps/plugin-fs` outside `src/files/*` and allowlist.
- Forbid `invoke(` outside `src/lib/ipc/call.ts`.

**Implementation**
- Add `scripts/guards/no-direct-invoke.sh`:
  ```bash
  #!/bin/bash
  set -e
  hits=$(git grep -n 'invoke(' -- src | grep -v 'src/lib/ipc/call.ts' || true)
  if [ -n "$hits" ]; then
    echo "Forbidden invoke() usage outside src/lib/ipc/call.ts:"
    echo "$hits"
    exit 1
  fi
  echo "no-direct-invoke: OK"
