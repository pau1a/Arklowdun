#!/usr/bin/env pwsh
# Helper for support engineers. See docs/support/household-db-remediation.md.
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
  Write-Error "Failed to resolve repository root. Ensure git is available."
  exit 1
}

$nodeScript = Join-Path $repoRoot "scripts/dev/household_stats.mjs"
if (-not (Test-Path $nodeScript)) {
  Write-Error "Missing helper script: $nodeScript"
  exit 1
}

$node = Get-Command node -ErrorAction Stop
& $node.Path $nodeScript @Args
exit $LASTEXITCODE
