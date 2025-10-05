# Support Playbook

## Household inventory snapshot

Use the household inventory snapshot to confirm that data isolation rules are
holding and to verify row counts before and after repair work.

### IPC / App layer

Developers and support engineers can call the `diagnostics_household_stats`
command through the IPC bridge. The TypeScript helper returns normalised
records:

```ts
import { fetchHouseholdStats } from "api/diagnostics";

const stats = await fetchHouseholdStats();
```

Each entry includes the household identifier, display name, whether it is the
current default, and a map of entity counts across notes, files, events, and
other supported domains.

### CLI

To inspect the same data from the command line, run the dedicated Tauri CLI
command:

```bash
npm run --silent tauri -- diagnostics household-stats
```

Pass `--json` to emit a machine-readable document:

```bash
npm run --silent tauri -- diagnostics household-stats -- --json
```

The CLI validates database health before executing and prints a table that
highlights per-household totals.

### Helper scripts

For quick access, use the bundled wrapper scripts:

- **macOS/Linux:** `scripts/dev/household_stats.sh` (pass `--json` for JSON)
- **Windows:** `scripts/dev/household_stats.ps1 -Json`
- **Support smoke:** `scripts/dev/household_stats.sh` mirrors the CLI, annotates
  cascade/vacuum status, and exits non-zero when a household is unhealthy.

Both scripts call the CLI command above, ensure the output is non-empty, and
bubble up the exit status if the inspection fails.
