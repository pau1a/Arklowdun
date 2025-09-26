# Licensing Inventory Pipeline

The licensing inventory pipeline normalises dependency metadata from both npm
and Cargo lockfiles into a shared schema that downstream compliance gates can
reason about. The orchestrator produces ecosystem-specific reports as well as a
unified view that deduplicates packages crossing the JavaScript/Rust boundary.

## Usage

```bash
npm run licensing:inventory
```

The command runs the following steps:

1. Parse `package-lock.json` to build `artifacts/licensing/npm-inventory.json`.
2. Parse `src-tauri/Cargo.lock` (plus `cargo metadata`) to build
   `artifacts/licensing/cargo-inventory.json`.
3. Merge both inventories into `artifacts/licensing/full-inventory.json`,
   reconciling license data and recording provenance for each ecosystem.

All inventories are validated against `schema/licensing-inventory.schema.json`.
The CLI exits with status `2` whenever warnings (for example, missing licenses
or unparsable SPDX expressions) are detected so that CI surfaces actionable
follow-up immediately.

### Options

The pipeline accepts a small number of flags when invoked via `tsx` or `node`:

| Flag | Description | Default |
| --- | --- | --- |
| `--npm-lockfile` | Path to an npm `package-lock.json` | `./package-lock.json` |
| `--cargo-lockfile` | Path to the workspace `Cargo.lock` | `./src-tauri/Cargo.lock` |
| `--cargo-manifest` | Path to the root `Cargo.toml` (used when invoking `cargo metadata`) | `./src-tauri/Cargo.toml` |
| `--cargo-metadata` | Optional JSON file containing pre-recorded `cargo metadata` output | _generated on the fly_ |
| `--schema` / `-s` | Path to the shared inventory schema | `./schema/licensing-inventory.schema.json` |
| `--output` / `-o` | Directory where inventory artifacts are written | `./artifacts/licensing` |
| `--overrides` | Optional overrides file (YAML or JSON) | `./scripts/licensing/overrides.yaml` when present |

Example running against the synthetic fixtures bundled with the repository:

```bash
npx tsx scripts/licensing/pipeline.ts \
  --npm-lockfile fixtures/licensing/package-lock.fixture.json \
  --cargo-lockfile fixtures/licensing/Cargo.lock.fixture \
  --cargo-metadata fixtures/licensing/cargo-metadata.json \
  --output fixtures/licensing
```

## Overrides

When upstream packages are missing SPDX data or disagree across ecosystems you
can provide overrides in `scripts/licensing/overrides.yaml`. Keys may be either a
bare package name or the fully qualified `name@version` tuple. Each entry accepts
the following fields:

- `licenses` – canonical SPDX identifiers to apply.
- `notes` – explanatory text that will be appended to the dependency entry.
- `ecosystems` – optional list restricting the override to specific scopes (`npm`,
  `cargo`, or `aggregate`).

Example:

```yaml
dual-lib@1.2.3:
  licenses:
    - MIT
    - Apache-2.0
  ecosystems:
    - aggregate
  notes: Verified dual-license via upstream notice
```

Overrides are validated during the pipeline run: entries that no longer match an
observed dependency cause the job to fail so stale entries can be cleaned up.

## Troubleshooting

- **Missing license metadata** – the parser emits warnings and marks the entry
  with `UNKNOWN`. Add an override while coordinating with the upstream owner.
- **Unparsable SPDX expression** – the raw expression is surfaced in the CLI
  output for manual review. Update the package or add an override with the
  correct identifiers.
- **Schema validation errors** – the CLI exits with details when the generated
  JSON does not satisfy the schema. Ensure custom tooling writes all required
  fields before consuming the artifact.
- **Cross-ecosystem conflicts** – when npm and Cargo disagree on a dependency's
  license, the merge step fails until an aggregate override specifies the
  canonical license set.
