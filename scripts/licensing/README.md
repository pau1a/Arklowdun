# Licensing Inventory Pipeline

The licensing inventory pipeline normalises dependency metadata from npm lockfiles
into a shared schema that downstream gates can reason about.

## Usage

```bash
npm run licensing:inventory
```

The command reads the root `package-lock.json`, validates the output against
`schema/licensing-inventory.schema.json`, and writes the machine-readable
inventory to `artifacts/licensing/npm-inventory.json`. The CLI exits with status
`2` whenever warnings (for example, missing licenses) are detected so that CI
surfaces actionable follow-up immediately.

### Options

The CLI accepts a small number of flags when invoked via `tsx` or `node`:

| Flag | Description | Default |
| --- | --- | --- |
| `--lockfile` / `-l` | Path to an npm `package-lock.json` | `./package-lock.json` |
| `--output` / `-o` | Output path for the generated inventory | `./artifacts/licensing/npm-inventory.json` |
| `--schema` / `-s` | Path to the shared inventory schema | `./schema/licensing-inventory.schema.json` |
| `--overrides` | Optional JSON file providing manual license notes or corrections | _none_ |

Example running against a fixture lockfile:

```bash
npx tsx scripts/licensing/npm-inventory.ts \
  --lockfile fixtures/licensing/package-lock.fixture.json \
  --output fixtures/licensing/npm-inventory.json
```

## Overrides

When upstream packages are missing SPDX data you can provide overrides in a
simple JSON map. Keys may be either a bare package name or the fully qualified
`name@version` tuple. The default override file lives at
`scripts/licensing/npm-overrides.json` and is loaded automatically when present.
Example:

```json
{
  "left-pad": {
    "licenses": ["MIT"],
    "notes": "Verified manually via upstream repository"
  }
}
```

## Troubleshooting

- **Missing license metadata** – the parser emits warnings and marks the entry
  with `UNKNOWN`. Add an override while coordinating with the upstream owner.
- **Unparsable SPDX expression** – the raw expression is surfaced in the CLI
  output for manual review. Update the package or add an override with the
  correct identifiers.
- **Schema validation errors** – the CLI exits with details when the generated
  JSON does not satisfy the schema. Ensure custom tooling writes all required
  fields before consuming the artifact.
